import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { type Tool, type ToolSet, tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ModelShortcutsConfig, ModelsConfig } from "../config/schema.ts";
import { articles, memories, projects } from "../db/schema.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import { type CancelRegistry, createCancelRegistry } from "../runner/cancel-registry.ts";
import {
  type StreamRegistry,
  appendMessage,
  createSession,
  createStreamRegistry,
  createToolPermissionStore,
  findChildByToolCall,
  getSession,
  getSessionMessages,
  setSessionStatus,
  updateSessionImageModel,
} from "../sessions/index.ts";
import { workflowSchema } from "../workflows/index.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// Provider-level (v3) usage; the SDK rolls these into flat input/output/total.
const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finishReason = (unified: "stop" | "tool-calls") => ({ unified, raw: unified });

const streamingModel = (chunks: LanguageModelV3StreamPart[]): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(chunks) }),
  }) as unknown as LlmModel;

// Calls `toolName` on its first step, then answers once the result is fed back —
// the multi-step loop a tool-enabled turn drives.
const toolCallModel = (toolName: string, input = '{"title":"Bug"}'): LlmModel => {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      step += 1;
      if (step === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "tool-call", toolCallId: "c1", toolName, input },
            { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Done" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: finishReason("stop"), usage: usage(3, 4) },
        ]),
      };
    },
  }) as unknown as LlmModel;
};

// The single tool part of an assistant message, for asserting its state.
type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  approval?: { id: string; approved?: boolean };
};
const toolPartOf = (row: { parts: unknown } | undefined): ToolPart =>
  (row?.parts as ToolPart[]).find((p) => p.type.startsWith("tool-")) as ToolPart;

// Emits a little then stays open: only an abort ends it, so a turn against it
// parks until cancelled — making the cancel path deterministic.
const pendingModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t1" });
          controller.enqueue({ type: "text-delta", id: "t1", delta: "Hel" });
        },
      }),
    }),
  }) as unknown as LlmModel;

// Configurable LlmClients fake. Routes call resolveModel, listModels, and —
// for session titling — generateText, whose default answers with an empty
// title so no fake-titled session leaks into unrelated tests.
const fakeClients = (
  opts: {
    model?: LlmModel;
    resolveError?: string;
    models?: { id: string; provider: string; output: "text" | "image"; reasoning?: boolean }[];
    generateText?: LlmClients["generateText"];
  } = {},
): LlmClients => ({
  resolveModel: () => {
    if (opts.resolveError) throw new Error(opts.resolveError);
    return opts.model ?? (new MockLanguageModelV3({}) as unknown as LlmModel);
  },
  resolveImageModel: () => {
    throw new Error("no image model in this fake");
  },
  generateText: opts.generateText ?? (async () => ({ text: "", usage: {} })),
  listModels: async () => ({
    models: (opts.models ?? []).map((model) => ({ reasoning: false, ...model })),
    failures: [],
  }),
  contextWindowFor: async () => undefined,
  reasoningOptionsFor: async () => undefined,
});

// Bus paired with a `waitForSettled(id)` that resolves when a session returns
// to idle or reaches a terminal state. Register the waiter before draining a
// turn's streamed response so the settle event is never missed.
const createSessionWaiter = () => {
  const bus = createEventBus();
  const pending = new Map<string, () => void>();
  bus.subscribe((e: KiriEvent) => {
    const settledId =
      (e.type === "session.updated" && e.status === "idle") || e.type === "session.finished"
        ? e.id
        : undefined;
    if (settledId === undefined) return;
    pending.get(settledId)?.();
    pending.delete(settledId);
  });
  const waitForSettled = (id: string): Promise<void> =>
    new Promise((resolve) => pending.set(id, resolve));
  return { bus, waitForSettled };
};

describe("sessions routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  const makeApp = (
    clients: LlmClients,
    extra: {
      bus?: EventBus;
      cancelRegistry?: CancelRegistry;
      mcpRegistry?: McpRegistry;
      streamRegistry?: StreamRegistry;
      getModelsConfig?: () => ModelsConfig;
      getDefaultWorkingDirectory?: () => string | undefined;
    } = {},
  ) =>
    createApp({
      db: env.db,
      registry: env.registry,
      config: env.config,
      llmClients: clients,
      ...extra,
    });

  // A registry whose tools() returns a fixed set; the route only reads tools().
  const fakeMcp = (tools: ToolSet): McpRegistry => ({
    tools: () => tools,
    status: () => [],
    catalog: () => [],
    replace: async () => {},
    close: async () => {},
  });

  const mcpTool = (): Tool =>
    tool({
      description: "create an issue",
      inputSchema: z.object({ title: z.string() }),
      execute: async () => "created",
    });

  const postMessage = (app: ReturnType<typeof createApp>, id: string, text: string) =>
    app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { role: "user", parts: [{ type: "text", text }] } }),
    });

  describe("GET /api/models", () => {
    it("returns the aggregated model listing", async () => {
      const app = makeApp(
        fakeClients({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
        }),
      );

      const res = await app.request("/api/models");

      expect(res.status).toBe(200);
      // The reasoning flag is server-side send-or-omit state, stripped from
      // the response — the client surface doesn't carry it.
      expect(await res.json()).toEqual({
        models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
        failures: [],
        shortcuts: {},
      });
    });

    it("carries the configured model shortcuts alongside the listing", async () => {
      const shortcuts = {
        text: { sonnet: "a:mid", haiku: "a:small" },
      };
      const app = makeApp(fakeClients(), {
        getModelsConfig: () => ({ shortcuts, delegates: {} }),
      });

      const res = await app.request("/api/models");

      expect(res.status).toBe(200);
      expect(((await res.json()) as { shortcuts: ModelShortcutsConfig }).shortcuts).toEqual(
        shortcuts,
      );
    });
  });

  describe("POST /api/sessions", () => {
    it("creates a session against the model and publishes session.started", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { session: { id: string; model: string; status: string } };
      expect(body.session.model).toBe(MODEL);
      expect(body.session.status).toBe("idle");
      expect(getSession(env.db, body.session.id)?.model).toBe(MODEL);
      expect(events).toContainEqual({ type: "session.started", id: body.session.id });
    });

    it("creates a session with an image model when the body carries one", async () => {
      const app = makeApp(fakeClients());

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, imageModel: "openai:gpt-image" }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { session: { id: string; imageModel: string | null } };
      expect(body.session.imageModel).toBe("openai:gpt-image");
      expect(getSession(env.db, body.session.id)?.imageModel).toBe("openai:gpt-image");
    });

    it("creates a session within a project when the body carries one", async () => {
      env.db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
      const app = makeApp(fakeClients());

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, projectId: "p1" }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { session: { id: string; projectId: string | null } };
      expect(body.session.projectId).toBe("p1");
      expect(getSession(env.db, body.session.id)?.projectId).toBe("p1");
    });

    it("400s a create naming a project that doesn't exist", async () => {
      const app = makeApp(fakeClients());

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, projectId: "missing" }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'project "missing" not found' });
    });

    it("starts the session working from the configured default directory", async () => {
      const app = makeApp(fakeClients(), { getDefaultWorkingDirectory: () => env.cwd });

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { session: { id: string; cwd: string | null } };
      expect(body.session.cwd).toBe(env.cwd);
      expect(getSession(env.db, body.session.id)?.cwd).toBe(env.cwd);
    });

    it("starts the session without a working directory when the default is unset or not on disk", async () => {
      for (const getDefaultWorkingDirectory of [
        undefined,
        () => undefined,
        () => join(env.cwd, "gone"),
      ]) {
        const app = makeApp(fakeClients(), { getDefaultWorkingDirectory });

        const res = await app.request("/api/sessions", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL }),
        });

        expect(res.status).toBe(201);
        expect(((await res.json()) as { session: { cwd: string | null } }).session.cwd).toBeNull();
      }
    });

    it("rejects an image model that does not resolve, creating nothing", async () => {
      const clients = fakeClients();
      clients.resolveModel = (id: string) => {
        if (id === "ghost:image") throw new Error('unknown llm provider "ghost"');
        return new MockLanguageModelV3({}) as unknown as LlmModel;
      };
      const app = makeApp(clients);

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, imageModel: "ghost:image" }),
      });

      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({
        error: 'unknown llm provider "ghost"',
      });
    });

    it("rejects a model that does not resolve", async () => {
      const app = makeApp(fakeClients({ resolveError: 'unknown llm provider "ghost"' }));

      const res = await app.request("/api/sessions", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "ghost:model" }),
      });

      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({
        error: 'unknown llm provider "ghost"',
      });
    });
  });

  describe("GET /api/sessions", () => {
    it("lists sessions newest-first and pages with the keyset cursor", async () => {
      createSession(env.db, MODEL, { id: "s1", startedAt: new Date(1000) });
      createSession(env.db, MODEL, { id: "s2", startedAt: new Date(2000) });
      createSession(env.db, MODEL, { id: "s3", startedAt: new Date(3000) });
      const app = makeApp(fakeClients());

      const page1 = (await (await app.request("/api/sessions?limit=2")).json()) as {
        sessions: { id: string }[];
        nextCursor: string | null;
      };
      expect(page1.sessions.map((s) => s.id)).toEqual(["s3", "s2"]);
      expect(page1.nextCursor).toBe("s2");

      const page2 = (await (
        await app.request(`/api/sessions?limit=2&cursor=${page1.nextCursor}`)
      ).json()) as { sessions: { id: string }[]; nextCursor: string | null };
      expect(page2.sessions.map((s) => s.id)).toEqual(["s1"]);
      expect(page2.nextCursor).toBeNull();
    });

    it("names each session's project on the row", async () => {
      env.db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
      createSession(env.db, MODEL, { id: "s1", startedAt: new Date(1000), projectId: "p1" });
      createSession(env.db, MODEL, { id: "s2", startedAt: new Date(2000) });
      const app = makeApp(fakeClients());

      const page = (await (await app.request("/api/sessions")).json()) as {
        sessions: { id: string; projectName: string | null }[];
      };
      expect(page.sessions.find((s) => s.id === "s1")?.projectName).toBe("Research");
      expect(page.sessions.find((s) => s.id === "s2")?.projectName).toBeNull();
    });

    it("labels each session with a preview of its first user message", async () => {
      createSession(env.db, MODEL, { id: "s1", startedAt: new Date(1000) });
      appendMessage(env.db, "s1", {
        role: "user",
        parts: [{ type: "text", text: "Summarise the readme" }],
      });
      createSession(env.db, MODEL, { id: "s2", startedAt: new Date(2000) }); // no messages
      const app = makeApp(fakeClients());

      const page = (await (await app.request("/api/sessions")).json()) as {
        sessions: { id: string; preview: string | null }[];
      };
      const byId = new Map(page.sessions.map((s) => [s.id, s.preview]));
      expect(byId.get("s1")).toBe("Summarise the readme");
      expect(byId.get("s2")).toBeNull();
    });

    it("carries each session's articles on its list row", async () => {
      createSession(env.db, MODEL, { id: "s1", startedAt: new Date(1000) });
      createSession(env.db, MODEL, { id: "s2", startedAt: new Date(2000) }); // no articles
      env.db
        .insert(articles)
        .values({
          id: "a1",
          sessionId: "s1",
          slug: "notes",
          name: "Notes",
          contentMd: "# Meeting notes\n\nbody",
          createdAt: new Date(1500),
        })
        .run();
      const app = makeApp(fakeClients());

      const page = (await (await app.request("/api/sessions")).json()) as {
        sessions: {
          id: string;
          articles: { slug: string; name: string; heading: string | null; createdAt: string }[];
        }[];
      };
      const byId = new Map(page.sessions.map((s) => [s.id, s.articles]));
      expect(byId.get("s1")).toEqual([
        {
          slug: "notes",
          name: "Notes",
          heading: "Meeting notes",
          createdAt: new Date(1500).toISOString(),
        },
      ]);
      expect(byId.get("s2")).toEqual([]);
    });

    it("400s an unknown cursor", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions?cursor=nope");
      expect(res.status).toBe(400);
    });

    it("excludes child sessions from the list", async () => {
      createSession(env.db, MODEL, { id: "top", startedAt: new Date(1000) });
      createSession(env.db, MODEL, {
        id: "child",
        startedAt: new Date(2000),
        parentSessionId: "top",
        parentToolCallId: "call_1",
      });
      const app = makeApp(fakeClients());

      const page = (await (await app.request("/api/sessions")).json()) as {
        sessions: { id: string }[];
      };
      expect(page.sessions.map((s) => s.id)).toEqual(["top"]);
    });
  });

  describe("GET /api/sessions/:id", () => {
    it("returns the session and its messages", async () => {
      const model = streamingModel([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
      ]);
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      const session = createSession(env.db, MODEL, { id: "s1" });
      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "Hi there")).text();
      await settled;

      const res = await app.request(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        session: { id: string };
        messages: { role: string }[];
      };
      expect(body.session.id).toBe("s1");
      expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/sessions/:id/children", () => {
    it("lists the session's children oldest-first with their lineage", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      createSession(env.db, MODEL, {
        id: "c2",
        startedAt: new Date(2000),
        parentSessionId: "s1",
        parentToolCallId: "call_2",
      });
      createSession(env.db, MODEL, {
        id: "c1",
        startedAt: new Date(1000),
        parentSessionId: "s1",
        parentToolCallId: "call_1",
      });
      // Another session's child never leaks into this listing.
      createSession(env.db, MODEL, { id: "s2" });
      createSession(env.db, MODEL, {
        id: "other-child",
        parentSessionId: "s2",
        parentToolCallId: "call_3",
      });

      const res = await app.request("/api/sessions/s1/children");

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        children: { id: string; parentToolCallId: string; status: string }[];
      };
      expect(body.children.map((c) => [c.id, c.parentToolCallId])).toEqual([
        ["c1", "call_1"],
        ["c2", "call_2"],
      ]);
    });

    it("returns an empty list for a session with no children", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const res = await app.request("/api/sessions/s1/children");
      expect(((await res.json()) as { children: unknown[] }).children).toEqual([]);
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost/children");
      expect(res.status).toBe(404);
    });
  });

  describe("session article reads", () => {
    const insertArticle = (sessionId: string, slug: string, contentMd: string, createdAt: Date) =>
      env.db
        .insert(articles)
        .values({
          id: crypto.randomUUID(),
          sessionId,
          slug,
          name: "Notes",
          contentMd,
          createdAt,
        })
        .run();

    it("lists a session's articles oldest-first with headings, without bodies", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      createSession(env.db, MODEL, { id: "s2" });
      insertArticle("s1", "second", "No leading heading here.", new Date(2000));
      insertArticle("s1", "first", "# First Article\n\nBody.", new Date(1000));
      insertArticle("s2", "elsewhere", "# Other", new Date(500));

      const res = await app.request("/api/sessions/s1/articles", { headers: CLIENT_HEADERS });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { articles: Record<string, unknown>[] };
      expect(body.articles).toEqual([
        {
          slug: "first",
          name: "Notes",
          heading: "First Article",
          createdAt: new Date(1000).toISOString(),
        },
        { slug: "second", name: "Notes", heading: null, createdAt: new Date(2000).toISOString() },
      ]);
    });

    it("returns an empty list for a session with no articles", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      const res = await app.request("/api/sessions/s1/articles", { headers: CLIENT_HEADERS });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ articles: [] });
    });

    it("404s listing articles for an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost/articles", { headers: CLIENT_HEADERS });
      expect(res.status).toBe(404);
    });

    it("serves one article with its full body and heading", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      insertArticle("s1", "notes", "# Meeting Notes\n\nBody.", new Date(1000));

      const res = await app.request("/api/sessions/s1/articles/notes", { headers: CLIENT_HEADERS });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        sessionId: "s1",
        slug: "notes",
        name: "Notes",
        contentMd: "# Meeting Notes\n\nBody.",
        heading: "Meeting Notes",
        createdAt: new Date(1000).toISOString(),
      });
    });

    it("names the producing session on the article so the reader can situate it", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1", title: "Corpus sweep" });
      insertArticle("s1", "notes", "# Meeting Notes\n\nBody.", new Date(1000));

      const res = await app.request("/api/sessions/s1/articles/notes", { headers: CLIENT_HEADERS });

      expect((await res.json()) as Record<string, unknown>).toMatchObject({
        sessionLabel: "Corpus sweep",
      });
    });

    it("404s an article absent from the session", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const res = await app.request("/api/sessions/s1/articles/ghost", { headers: CLIENT_HEADERS });
      expect(res.status).toBe(404);
    });

    it("404s fetching an article on an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost/articles/notes", {
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("400s a malformed article slug", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const res = await app.request("/api/sessions/s1/articles/Bad_Slug", {
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(400);
    });

    it("deletes a session article and publishes article.deleted", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      insertArticle("s1", "notes", "# Meeting Notes\n\nBody.", new Date(1000));

      const res = await app.request("/api/sessions/s1/articles/notes", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      expect(events).toContainEqual({ type: "article.deleted", sessionId: "s1", slug: "notes" });
      expect(env.db.select().from(articles).all()).toEqual([]);
    });

    it("404s deleting an article absent from the session", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const res = await app.request("/api/sessions/s1/articles/ghost", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("cannot reach a project-owned article through the session route", async () => {
      env.db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
      createSession(env.db, MODEL, { id: "s1", projectId: "p1" });
      env.db
        .insert(articles)
        .values({
          id: "a1",
          projectId: "p1",
          slug: "corpus-doc",
          name: "Doc",
          contentMd: "# Doc",
          createdAt: new Date(),
        })
        .run();
      const app = makeApp(fakeClients());

      const res = await app.request("/api/sessions/s1/articles/corpus-doc", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(404);
      expect(env.db.select().from(articles).all()).toHaveLength(1);
    });
  });

  describe("GET /api/sessions/:id/stream", () => {
    it("serves the in-flight turn's buffered event-stream to a reconnecting client", async () => {
      // Seed a registry as a live turn would, then inject it: a fresh client
      // reconnecting gets a 200 event-stream replaying the frames so far. (Driving
      // a real parked turn deadlocks here — happy-dom's Response can't serve two
      // concurrent streaming bodies; live capture is covered by the stream-registry
      // tests and the client resume tests.)
      const streamRegistry = createStreamRegistry();
      const sink = streamRegistry.open("s1");
      sink.push('data: {"type":"text-delta","delta":"rejoined"}\n\n');
      const app = makeApp(fakeClients(), { streamRegistry });
      createSession(env.db, MODEL, { id: "s1" });

      const res = await app.request("/api/sessions/s1/stream");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      // Closing lets the reconnected stream reach EOF so its replay reads back.
      sink.close();
      expect(await res.text()).toContain("rejoined");
    });

    it("204s when no turn is in flight for the session", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      const res = await app.request("/api/sessions/s1/stream");

      expect(res.status).toBe(204);
    });

    it("204s once the turn has settled and its stream is gone", async () => {
      const model = streamingModel([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
      ]);
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "Hi there")).text();
      await settled;

      const res = await app.request("/api/sessions/s1/stream");

      expect(res.status).toBe(204);
    });
  });

  describe("GET /api/sessions/:id/suggested-replies", () => {
    const UTILITY = "local:tiny";

    // Clients whose generateText answers with a fixed suggestion block,
    // recording each call so a guard case can assert nothing was generated.
    const suggestingClients = () => {
      const calls: { model: string; prompt: string }[] = [];
      const clients = fakeClients();
      clients.generateText = async ({ model, prompt }) => {
        calls.push({ model, prompt });
        return { text: "ENDING: confirmation\nYes, proceed\nNo, hold off", usage: {} };
      };
      return { clients, calls };
    };

    const withUtility = () => ({ shortcuts: {}, delegates: {}, utility: UTILITY });

    // An idle session whose last message is a plain assistant reply — the one
    // shape that generates.
    const seedSettledTurn = (id: string, assistantText = "Shall I go ahead?") => {
      createSession(env.db, MODEL, { id });
      appendMessage(env.db, id, { role: "user", parts: [{ type: "text", text: "Do the thing" }] });
      appendMessage(env.db, id, {
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
      });
    };

    const getReplies = (app: ReturnType<typeof createApp>, id: string) =>
      app.request(`/api/sessions/${id}/suggested-replies`);

    it("404s for an unknown session", async () => {
      const app = makeApp(fakeClients(), { getModelsConfig: withUtility });

      const res = await getReplies(app, "nope");

      expect(res.status).toBe(404);
    });

    it("generates replies for a settled assistant turn with the utility model", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      seedSettledTurn("s1", "Shall I go ahead with the rename?");

      const res = await getReplies(app, "s1");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replies: ["Yes, proceed", "No, hold off"] });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.model).toBe(UTILITY);
      expect(calls[0]?.prompt).toContain("Shall I go ahead with the rename?");
    });

    it("returns no replies without generating when no utility model is configured", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients);
      seedSettledTurn("s1");

      const res = await getReplies(app, "s1");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies for a delegated child session", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      createSession(env.db, MODEL, { id: "parent" });
      createSession(env.db, MODEL, {
        id: "child",
        parentSessionId: "parent",
        parentToolCallId: "c1",
      });
      appendMessage(env.db, "child", { role: "user", parts: [{ type: "text", text: "Task" }] });
      appendMessage(env.db, "child", {
        role: "assistant",
        parts: [{ type: "text", text: "Shall I go ahead?" }],
      });

      const res = await getReplies(app, "child");

      expect(await res.json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies while a turn is in flight", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      seedSettledTurn("s1");
      setSessionStatus(env.db, "s1", "running");

      const res = await getReplies(app, "s1");

      expect(await res.json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies when the last message is not an assistant reply", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      createSession(env.db, MODEL, { id: "empty" });
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "Hello?" }] });

      expect(await (await getReplies(app, "empty")).json()).toEqual({ replies: [] });
      expect(await (await getReplies(app, "s1")).json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies while a tool approval is pending", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "Create it" }] });
      appendMessage(env.db, "s1", {
        role: "assistant",
        parts: [
          { type: "text", text: "I'd like to run this — allow it?" },
          {
            type: "tool-create_issue",
            state: "approval-requested",
            toolCallId: "c1",
            input: { title: "Bug" },
            approval: { id: "a1" },
          },
        ],
      });

      const res = await getReplies(app, "s1");

      expect(await res.json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies for an assistant message with no text", async () => {
      const { clients, calls } = suggestingClients();
      const app = makeApp(clients, { getModelsConfig: withUtility });
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "Run it" }] });
      appendMessage(env.db, "s1", {
        role: "assistant",
        parts: [
          {
            type: "tool-create_issue",
            state: "output-available",
            toolCallId: "c1",
            input: { title: "Bug" },
            output: "created",
          },
        ],
      });

      const res = await getReplies(app, "s1");

      expect(await res.json()).toEqual({ replies: [] });
      expect(calls).toHaveLength(0);
    });

    it("returns no replies when generation fails", async () => {
      const clients = fakeClients();
      clients.generateText = async () => {
        throw new Error("provider down");
      };
      const app = makeApp(clients, { getModelsConfig: withUtility });
      seedSettledTurn("s1");

      const res = await getReplies(app, "s1");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replies: [] });
    });
  });

  describe("PATCH /api/sessions/:id", () => {
    const patchModel = (app: ReturnType<typeof createApp>, id: string, model: string) =>
      app.request(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });

    it("updates the session's model and publishes session.updated", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchModel(app, "s1", "anthropic:claude");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { model: string } };
      expect(body.session.model).toBe("anthropic:claude");
      expect(getSession(env.db, "s1")?.model).toBe("anthropic:claude");
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await patchModel(app, "ghost", "anthropic:claude");
      expect(res.status).toBe(404);
    });

    it("rejects a model that does not resolve and leaves the model unchanged", async () => {
      const app = makeApp(fakeClients({ resolveError: 'unknown llm provider "ghost"' }));
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchModel(app, "s1", "ghost:model");

      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({
        error: 'unknown llm provider "ghost"',
      });
      expect(getSession(env.db, "s1")?.model).toBe(MODEL);
    });

    const patchBody = (app: ReturnType<typeof createApp>, id: string, body: unknown) =>
      app.request(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("rejects any cwd write — the working directory has no app-side writer", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      expect((await patchBody(app, "s1", { cwd: null })).status).toBe(400);
      expect((await patchBody(app, "s1", { cwd: "/somewhere/else" })).status).toBe(400);
    });

    it("sets and clears the session's image model", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      expect(getSession(env.db, "s1")?.imageModel).toBeNull();

      const res = await patchBody(app, "s1", { imageModel: "openrouter:gemini-image" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { imageModel: string | null } };
      expect(body.session.imageModel).toBe("openrouter:gemini-image");
      expect(getSession(env.db, "s1")?.imageModel).toBe("openrouter:gemini-image");

      const cleared = await patchBody(app, "s1", { imageModel: null });

      expect(cleared.status).toBe(200);
      expect(getSession(env.db, "s1")?.imageModel).toBeNull();
    });

    it("rejects an image model that does not resolve and leaves it unchanged", async () => {
      const app = makeApp(fakeClients({ resolveError: 'unknown llm provider "ghost"' }));
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchBody(app, "s1", { imageModel: "ghost:model" });

      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({
        error: 'unknown llm provider "ghost"',
      });
      expect(getSession(env.db, "s1")?.imageModel).toBeNull();
    });

    it("updates the session's effort and publishes session.updated", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      expect(getSession(env.db, "s1")?.effort).toBe("medium");

      const res = await patchBody(app, "s1", { effort: "high" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { effort: string } };
      expect(body.session.effort).toBe("high");
      expect(getSession(env.db, "s1")?.effort).toBe("high");
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    });

    it("rejects an effort outside the levels and leaves it unchanged", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchBody(app, "s1", { effort: "ultra" });

      expect(res.status).toBe(400);
      expect(getSession(env.db, "s1")?.effort).toBe("medium");
    });

    it("renames and un-titles the session and publishes session.updated", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      expect(getSession(env.db, "s1")?.title).toBeNull();

      const res = await patchBody(app, "s1", { title: "  Postgres upgrade plan  " });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { title: string | null } };
      // The schema trims, so surrounding whitespace never reaches storage.
      expect(body.session.title).toBe("Postgres upgrade plan");
      expect(getSession(env.db, "s1")?.title).toBe("Postgres upgrade plan");
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });

      const cleared = await patchBody(app, "s1", { title: null });

      expect(cleared.status).toBe(200);
      expect(getSession(env.db, "s1")?.title).toBeNull();
    });

    it("rejects a blank or over-long title and leaves it unchanged", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      expect((await patchBody(app, "s1", { title: "   " })).status).toBe(400);
      expect((await patchBody(app, "s1", { title: "x".repeat(121) })).status).toBe(400);
      expect(getSession(env.db, "s1")?.title).toBeNull();
    });
  });

  describe("POST /api/sessions/:id/messages", () => {
    it("streams a turn and persists the messages, usage, and totals", async () => {
      const model = streamingModel([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-delta", id: "t1", delta: " world" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
      ]);
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "Hi there");
      expect(res.status).toBe(200);
      const streamed = await res.text();
      await settled;

      expect(streamed.length).toBeGreaterThan(0);
      const rows = getSessionMessages(env.db, "s1");
      expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
      expect(rows[1]?.contextTokens).toBe(9);
      const settledSession = getSession(env.db, "s1");
      expect(settledSession?.status).toBe("idle");
    });

    // A minimal complete text turn for tests that only care about the route's
    // side effects, not the streamed content.
    const helloTurn = (): LanguageModelV3StreamPart[] => [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishReason("stop"), usage: usage(3, 1) },
    ];

    // Title generation is fired without being awaited by the turn, so give
    // its promise chain a bounded window to land before asserting.
    const waitForTitle = async (id: string): Promise<string | null> => {
      for (let i = 0; i < 50 && getSession(env.db, id)?.title == null; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      return getSession(env.db, id)?.title ?? null;
    };

    it("titles an untitled session off its first message with the utility model", async () => {
      const titleCalls: string[] = [];
      const clients = fakeClients({ model: streamingModel(helloTurn()) });
      clients.generateText = async ({ model }) => {
        titleCalls.push(model);
        return { text: "Postgres upgrade help", usage: {} };
      };
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(clients, {
        bus,
        getModelsConfig: () => ({ shortcuts: {}, delegates: {}, utility: "local:tiny" }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "How do I upgrade Postgres?")).text();
      await settled;

      expect(await waitForTitle("s1")).toBe("Postgres upgrade help");
      expect(titleCalls).toEqual(["local:tiny"]);
    });

    it("falls back to the session's own model for titling when no utility model is configured", async () => {
      const titleCalls: string[] = [];
      const clients = fakeClients({ model: streamingModel(helloTurn()) });
      clients.generateText = async ({ model }) => {
        titleCalls.push(model);
        return { text: "A title", usage: {} };
      };
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(clients, { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "Hi there")).text();
      await settled;

      expect(await waitForTitle("s1")).toBe("A title");
      expect(titleCalls).toEqual([MODEL]);
    });

    it("fires title generation only for an untitled session's first message", async () => {
      const titleCalls: string[] = [];
      const clients = fakeClients({ model: streamingModel(helloTurn()) });
      clients.generateText = async ({ model }) => {
        titleCalls.push(model);
        return { text: "", usage: {} };
      };
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(clients, { bus });
      createSession(env.db, MODEL, { id: "titled", title: "Named at creation" });
      createSession(env.db, MODEL, { id: "s1" });

      let settled = waitForSettled("titled");
      await (await postMessage(app, "titled", "Hi")).text();
      await settled;
      expect(titleCalls).toHaveLength(0);

      // An untitled session tries once on its first message; a later message
      // never re-fires, even when that first generation left it untitled.
      settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "Hi")).text();
      await settled;
      expect(titleCalls).toHaveLength(1);

      settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "And another thing")).text();
      await settled;
      expect(titleCalls).toHaveLength(1);
      expect(getSession(env.db, "s1")?.title).toBeNull();
    });

    it("merges MCP server tools into the turn and names them for the system prompt", async () => {
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), {
        bus,
        mcpRegistry: fakeMcp({ linear__create_issue: mcpTool() }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "open an issue");
      await res.text();
      await settled;

      // The namespaced MCP tool was offered to the model, and the core prompt's
      // tool guidance turned on because the active tool set is non-empty.
      expect(toolNames).toContain("linear__create_issue");
      expect(systemText).toContain("You have tools available.");
    });

    it("offers the first-party article tools on every turn, without an MCP registry", async () => {
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "write me a digest")).text();
      await settled;

      expect(toolNames).toEqual(
        expect.arrayContaining([
          "create_article",
          "replace_article",
          "edit_article",
          "list_articles",
          "read_article",
        ]),
      );
      // The core prompt's article guidance turned on with the tools.
      expect(systemText).toContain("You can save articles");
    });

    it("runs an article tool straight through by default and persists the article", async () => {
      const input = JSON.stringify({ slug: "pr-digest", content_md: "# PR Digest\n\nBody." });
      const { bus, waitForSettled } = createSessionWaiter();
      const seen: KiriEvent[] = [];
      bus.subscribe((event) => seen.push(event));
      const app = makeApp(fakeClients({ model: toolCallModel("create_article", input) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "write me a digest")).text();
      await settled;

      // No approval pause with no recorded permission: the article tools
      // default to allow, so the tool ran and the model answered in the same
      // turn.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      expect(toolPartOf(rows[1]).output).toEqual({ slug: "pr-digest", name: "PR Digest" });

      const row = env.db.select().from(articles).where(eq(articles.sessionId, "s1")).get();
      expect(row?.slug).toBe("pr-digest");
      expect(row?.contentMd).toBe("# PR Digest\n\nBody.");
      expect(seen).toContainEqual({ type: "article.written", sessionId: "s1", slug: "pr-digest" });
    });

    it("runs a memory tool straight through by default and persists the memory", async () => {
      const input = JSON.stringify({
        name: "prefers-bun",
        description: "Prefers bun over node.",
        content_md: "Always reach for bun.",
      });
      const { bus, waitForSettled } = createSessionWaiter();
      const seen: KiriEvent[] = [];
      bus.subscribe((event) => seen.push(event));
      const app = makeApp(fakeClients({ model: toolCallModel("save_memory", input) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "remember I prefer bun")).text();
      await settled;

      // No approval pause with no recorded permission: the memory tools
      // default to allow, so the save ran and the model answered in the same
      // turn, with the write announced on the bus.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      expect(toolPartOf(rows[1]).output).toEqual({ name: "prefers-bun", saved: "created" });

      const row = env.db.select().from(memories).where(eq(memories.name, "prefers-bun")).get();
      expect(row?.contentMd).toBe("Always reach for bun.");
      expect(seen).toContainEqual({ type: "memory.saved", name: "prefers-bun" });
    });

    it("rewrites a project's instructions straight through for a project session", async () => {
      env.db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
      const input = JSON.stringify({ instructions_md: "Answer in British English." });
      const { bus, waitForSettled } = createSessionWaiter();
      const seen: KiriEvent[] = [];
      bus.subscribe((event) => seen.push(event));
      const app = makeApp(
        fakeClients({ model: toolCallModel("update_project_instructions", input) }),
        { bus },
      );
      createSession(env.db, MODEL, { id: "s1", projectId: "p1" });

      const settled = waitForSettled("s1");
      await (
        await postMessage(app, "s1", "put British English in the project instructions")
      ).text();
      await settled;

      // Allow by default, so the rewrite ran in the same turn, landed on the
      // project, and was announced for the open project page.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      const row = env.db.select().from(projects).where(eq(projects.id, "p1")).get();
      expect(row?.instructions).toBe("Answer in British English.");
      expect(seen).toContainEqual({ type: "project.updated", id: "p1" });
    });

    it("withholds an off article tool and drops its guidance from the prompt", async () => {
      // A built-in tool rides the same standing permissions as an MCP tool:
      // a recorded "off" overrides its allow default, withholding it, and the
      // article guidance keyed off create_article disappears with it.
      createToolPermissionStore(env.config.toolPermissionsFile()).set("create_article", "off");
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "write me a digest")).text();
      await settled;

      expect(toolNames).not.toContain("create_article");
      expect(toolNames).toContain("edit_article");
      expect(systemText).not.toContain("You can save articles");
    });

    it("offers generate_image only while an image model is selected", async () => {
      // The image tools self-gate on the session's selection the way the
      // filesystem tools self-gate on configuration.
      let toolNames: string[] = [];
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const first = waitForSettled("s1");
      await (await postMessage(app, "s1", "hello")).text();
      await first;
      expect(toolNames).not.toContain("generate_image");

      updateSessionImageModel(env.db, "s1", "fake:paint");
      const second = waitForSettled("s1");
      await (await postMessage(app, "s1", "hello again")).text();
      await second;
      expect(toolNames).toContain("generate_image");
    });

    it("offers the filesystem tools with sandbox guidance when kiri.yaml declares one", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "what files are there?")).text();
      await settled;

      expect(toolNames).toEqual(
        expect.arrayContaining(["find_files", "list_directory", "read_file", "search_files"]),
      );
      // The guidance layer turned on and enumerated the declared sandbox —
      // "." resolved against the workspace root.
      expect(systemText).toContain("You can work with the user's files");
      expect(systemText).toContain(`- ${env.cwd}`);
    });

    it("withholds the filesystem tools when no sandbox is declared", async () => {
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "what files are there?")).text();
      await settled;

      // Declaring the sandbox is what enables the capability: without it the
      // tools aren't offered and their guidance never appears, while the other
      // built-ins are unaffected.
      expect(toolNames).not.toContain("find_files");
      expect(toolNames).not.toContain("read_file");
      expect(toolNames).not.toContain("search_files");
      expect(toolNames).toContain("create_article");
      expect(systemText).not.toContain("You can work with the user's files");
    });

    it("withholds the filesystem tools when no declared directory exists on disk", async () => {
      // A declared sandbox whose every entry is missing is unusable: offering
      // the tools (and advertising the root) would just make each call fail.
      writeFileSync(
        join(env.cwd, "kiri.yaml"),
        `filesystem:\n  allowed_directories: [${join(env.cwd, "does-not-exist")}]\n`,
      );
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "what files are there?")).text();
      await settled;

      expect(toolNames).not.toContain("read_file");
      expect(systemText).not.toContain("You can work with the user's files");
    });

    it("runs a filesystem read tool straight through by default", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      writeFileSync(join(env.cwd, "notes.md"), "remember the milk\n");
      const input = JSON.stringify({ path: join(env.cwd, "notes.md") });
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("read_file", input) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "read my notes")).text();
      await settled;

      // No approval pause with no recorded permission: the filesystem read
      // tools default to allow, so the read ran and the model answered in the
      // same turn. The result reports the file's real path.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      expect(toolPartOf(rows[1]).output).toEqual({
        path: realpathSync(join(env.cwd, "notes.md")),
        content: "remember the milk\n",
      });
    });

    it("moves the session's working directory and publishes session.updated", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      mkdirSync(join(env.cwd, "docs"));
      // A relative path: resolved against the session's stored working
      // directory, exercising the row-backed read as well as the write.
      const input = JSON.stringify({ path: "docs" });
      const events: KiriEvent[] = [];
      const { bus, waitForSettled } = createSessionWaiter();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients({ model: toolCallModel("set_working_directory", input) }), {
        bus,
      });
      createSession(env.db, MODEL, { id: "s1", cwd: env.cwd });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "work in docs")).text();
      await settled;

      // The move ran without an approval pause (allow by default), persisted
      // onto the session row, and announced itself so the app can refresh.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      expect(toolPartOf(rows[1]).output).toEqual({ cwd: realpathSync(join(env.cwd, "docs")) });
      expect(getSession(env.db, "s1")?.cwd).toBe(realpathSync(join(env.cwd, "docs")));
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "running" });
    });

    it("heals a working directory that left the disk and announces the move to the model", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;
      const events: KiriEvent[] = [];
      const { bus, waitForSettled } = createSessionWaiter();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients({ model }), {
        bus,
        getDefaultWorkingDirectory: () => env.cwd,
      });
      createSession(env.db, MODEL, { id: "s1", cwd: join(env.cwd, "gone") });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "hello");
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      // The stale value was swapped for the configured default before the
      // turn ran, and the swap was announced so the app can refresh.
      expect(getSession(env.db, "s1")?.cwd).toBe(env.cwd);
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
      // The turn's system prompt told the model about the move.
      expect(systemText).toContain(`"${join(env.cwd, "gone")}" no longer exists`);
      expect(systemText).toContain(
        `moved to the configured default working directory, "${env.cwd}"`,
      );
    });

    it("clears a stale working directory outright when no usable default exists", async () => {
      // A declared default inside the sandbox but absent from disk: the
      // config loads, yet there is nothing usable to heal onto.
      writeFileSync(
        join(env.cwd, "kiri.yaml"),
        "filesystem:\n  allowed_directories: [.]\n  default_working_directory: missing-default\n",
      );
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1", cwd: join(env.cwd, "gone") });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "hello");
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      // With no default to fall back to the session ends up with none, and
      // the model hears that relative paths won't resolve until one is set.
      expect(getSession(env.db, "s1")?.cwd).toBeNull();
      expect(systemText).toContain("the session now has none");
    });

    it("heals a session without a working directory from the live default", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      const app = makeApp(fakeClients(), { getDefaultWorkingDirectory: () => env.cwd });
      createSession(env.db, MODEL, { id: "s1" });

      // Loading the session detail stamps the default onto the row.
      const res = await app.request("/api/sessions/s1");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { session: { cwd: string | null } }).session.cwd).toBe(env.cwd);
      expect(getSession(env.db, "s1")?.cwd).toBe(env.cwd);
    });

    it("leaves a session without a working directory alone when no default exists", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      const res = await app.request("/api/sessions/s1");
      expect(((await res.json()) as { session: { cwd: string | null } }).session.cwd).toBeNull();
      expect(getSession(env.db, "s1")?.cwd).toBeNull();
    });

    it("heals a working directory a config edit moved the sandbox out from under", async () => {
      mkdirSync(join(env.cwd, "inner"));
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [inner]\n");
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), {
        bus,
        getDefaultWorkingDirectory: () => join(env.cwd, "inner"),
      });
      // A directory that exists but now sits outside the narrowed sandbox.
      createSession(env.db, MODEL, { id: "s1", cwd: env.cwd });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "hello");
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      expect(getSession(env.db, "s1")?.cwd).toBe(join(env.cwd, "inner"));
      expect(systemText).toContain(`"${env.cwd}" is outside the allowed directories`);
    });

    it("plays the turn despite a stale working directory when no sandbox is declared", async () => {
      // With no sandbox the filesystem and shell tools are withheld outright,
      // so a stale cwd can't misdirect anything — a plain chat must not be
      // blocked by config it no longer uses.
      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "hi" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
          ]),
        }),
      }) as unknown as LlmModel;
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1", cwd: join(env.cwd, "gone") });

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "hello");
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      expect(getSession(env.db, "s1")?.status).toBe("idle");
    });

    it("states the working directory in the system prompt when the session has one", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1", cwd: env.cwd });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "where are we?")).text();
      await settled;

      expect(systemText).toContain(`The session's working directory is ${env.cwd}`);
      expect(systemText).toContain(
        "Move the session's working directory with set_working_directory",
      );
    });

    it("carries the project corpus map in the system prompt for a project session", async () => {
      env.db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
      env.db
        .insert(articles)
        .values({
          id: "a1",
          projectId: "p1",
          slug: "corpus-doc",
          name: "Corpus Doc",
          contentMd: "# Field Notes\n\nBody.",
          createdAt: new Date(),
        })
        .run();
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1", projectId: "p1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "what do we know?")).text();
      await settled;

      expect(systemText).toContain('This session belongs to the project "Research"');
      expect(systemText).toContain("- corpus-doc: Field Notes");
    });

    it("offers run_command with shell guidance when kiri.yaml declares a sandbox", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "run the tests")).text();
      await settled;

      expect(toolNames).toContain("run_command");
      // The guidance layer turned on with its safety contract, enumerating
      // the declared sandbox — "." resolved against the workspace root. One
      // declaration enables the whole file-and-shell surface, so the
      // filesystem tools ride along with it.
      expect(systemText).toContain("You can run shell commands");
      expect(systemText).toContain(`- ${env.cwd}`);
      expect(systemText).toContain("not your safety margin");
      expect(toolNames).toContain("read_file");
    });

    it("withholds run_command when no sandbox is declared", async () => {
      let toolNames: string[] = [];
      let systemText = "";
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "run the tests")).text();
      await settled;

      // Declaring where commands may run is what enables the capability:
      // without it the tool isn't offered and its guidance never appears.
      expect(toolNames).not.toContain("run_command");
      expect(systemText).not.toContain("You can run shell commands");
    });

    it("pauses run_command for approval by default, then runs it when approved", async () => {
      writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
      const input = JSON.stringify({ command: "echo hi" });
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("run_command", input) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "say hi in the shell")).text();
      await settled;

      // Unlike the filesystem reads, run_command executes model-authored
      // commands, so its default permission asks: the turn pauses with the
      // call unexecuted until the user answers.
      const paused = getSessionMessages(env.db, "s1");
      const pendingTool = toolPartOf(paused[1]);
      expect(pendingTool.state).toBe("approval-requested");
      expect(pendingTool.output).toBeUndefined();

      // Approving resumes the turn and the command actually runs, in the
      // workspace root the declared "." resolved to.
      const respondedParts = (paused[1]?.parts as ToolPart[]).map((part) =>
        part.state === "approval-requested"
          ? { ...part, state: "approval-responded", approval: { ...part.approval, approved: true } }
          : part,
      );
      const resumed = waitForSettled("s1");
      const res = await app.request("/api/sessions/s1/messages", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { role: "assistant", parts: respondedParts } }),
      });
      expect(res.status).toBe(200);
      await res.text();
      await resumed;

      const rows = getSessionMessages(env.db, "s1");
      const ranTool = toolPartOf(rows[1]);
      expect(ranTool.state).toBe("output-available");
      expect(ranTool.output).toEqual({
        cwd: realpathSync(env.cwd),
        exitCode: 0,
        stdout: "hi\n",
        stderr: "",
        durationMs: expect.any(Number),
      });
    });

    describe("run_command auto permission", () => {
      const UTILITY_MODELS = () => ({ shortcuts: {}, delegates: {}, utility: "fake:utility" });

      // Tracks judge calls and answers with a scripted reply.
      const scriptedJudge = (reply: string) => {
        const calls: { model: string; prompt: string }[] = [];
        const generateText: LlmClients["generateText"] = async ({ model, prompt }) => {
          calls.push({ model, prompt });
          return { text: reply, usage: {} };
        };
        return { calls, generateText };
      };

      const startAutoTurn = async (opts: {
        input: string;
        judgeReply?: string;
        modelsConfig?: () => ModelsConfig;
      }) => {
        writeFileSync(join(env.cwd, "kiri.yaml"), "filesystem:\n  allowed_directories: [.]\n");
        createToolPermissionStore(env.config.toolPermissionsFile()).set("run_command", "auto");
        const judge = scriptedJudge(opts.judgeReply ?? "");
        const { bus, waitForSettled } = createSessionWaiter();
        const app = makeApp(
          fakeClients({
            model: toolCallModel("run_command", opts.input),
            generateText: judge.generateText,
          }),
          { bus, getModelsConfig: opts.modelsConfig ?? UTILITY_MODELS },
        );
        // Pre-titled so first-turn title generation doesn't also call the
        // scripted generateText and muddy the judge-call assertions.
        createSession(env.db, MODEL, { id: "s1", title: "auto shell" });
        const settled = waitForSettled("s1");
        await (await postMessage(app, "s1", "run it")).text();
        await settled;
        return { app, judge, waitForSettled };
      };

      it("runs a screen-allowed command without consulting the judge", async () => {
        const { judge } = await startAutoTurn({ input: JSON.stringify({ command: "pwd" }) });

        const rows = getSessionMessages(env.db, "s1");
        const ranTool = toolPartOf(rows[1]);
        expect(ranTool.state).toBe("output-available");
        expect((ranTool.output as { stdout: string }).stdout).toBe(`${realpathSync(env.cwd)}\n`);
        expect(judge.calls).toEqual([]);
      });

      it("pauses a screen-triggered command without consulting the judge", async () => {
        const { judge } = await startAutoTurn({
          input: JSON.stringify({ command: "rm -rf build" }),
        });

        const pendingTool = toolPartOf(getSessionMessages(env.db, "s1")[1]);
        expect(pendingTool.state).toBe("approval-requested");
        expect(pendingTool.output).toBeUndefined();
        expect(judge.calls).toEqual([]);
      });

      it("runs a command the judge allows, judging with the utility model", async () => {
        const { judge } = await startAutoTurn({
          input: JSON.stringify({ command: "echo judged", cwd: env.cwd }),
          judgeReply: "EFFECTS: prints text\nVERDICT: allow\nREASON: harmless echo",
        });

        const ranTool = toolPartOf(getSessionMessages(env.db, "s1")[1]);
        expect(ranTool.state).toBe("output-available");
        expect((ranTool.output as { stdout: string }).stdout).toBe("judged\n");
        expect(judge.calls).toHaveLength(1);
        expect(judge.calls[0]?.model).toBe("fake:utility");
        expect(judge.calls[0]?.prompt).toContain("echo judged");
        expect(judge.calls[0]?.prompt).toContain(`Working directory: ${env.cwd}`);
      });

      it("pauses a command the judge asks about, then honours an approval", async () => {
        const { app, judge, waitForSettled } = await startAutoTurn({
          input: JSON.stringify({ command: "echo judged" }),
          judgeReply: "EFFECTS: unclear\nVERDICT: ask\nREASON: unsure",
        });

        const paused = getSessionMessages(env.db, "s1");
        const pendingTool = toolPartOf(paused[1]);
        expect(pendingTool.state).toBe("approval-requested");
        expect(judge.calls).toHaveLength(1);

        // Approving resumes and runs the call: the prior approval request is
        // honoured rather than the command being re-judged.
        const respondedParts = (paused[1]?.parts as ToolPart[]).map((part) =>
          part.state === "approval-requested"
            ? {
                ...part,
                state: "approval-responded",
                approval: { ...part.approval, approved: true },
              }
            : part,
        );
        const resumed = waitForSettled("s1");
        const res = await app.request("/api/sessions/s1/messages", {
          method: "POST",
          headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { role: "assistant", parts: respondedParts } }),
        });
        expect(res.status).toBe(200);
        await res.text();
        await resumed;

        expect(toolPartOf(getSessionMessages(env.db, "s1")[1]).state).toBe("output-available");
        expect(judge.calls).toHaveLength(1);
      });

      it("degrades to ask wholesale when no utility model is configured", async () => {
        // Even a screen-allowed command pauses: without a utility model the
        // permissions page states auto falls back to ask, so it must.
        const { judge } = await startAutoTurn({
          input: JSON.stringify({ command: "pwd" }),
          modelsConfig: () => ({ shortcuts: {}, delegates: {} }),
        });

        const pendingTool = toolPartOf(getSessionMessages(env.db, "s1")[1]);
        expect(pendingTool.state).toBe("approval-requested");
        expect(judge.calls).toEqual([]);
      });
    });

    it("persists the user message under the id the client sent", async () => {
      const model = streamingModel([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
      ]);
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      const res = await app.request("/api/sessions/s1/messages", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: { id: "client-msg-1", role: "user", parts: [{ type: "text", text: "hi" }] },
        }),
      });
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      // The stored user row keeps the client's id, so edit-and-resend can
      // truncate the transcript by it.
      const rows = getSessionMessages(env.db, "s1");
      expect(rows[0]?.role).toBe("user");
      expect(rows[0]?.id).toBe("client-msg-1");
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await postMessage(app, "ghost", "hi");
      expect(res.status).toBe(404);
    });

    it("409s when a turn is already in flight", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      setSessionStatus(env.db, "s1", "running");

      const res = await postMessage(app, "s1", "hi");

      expect(res.status).toBe(409);
      // No turn ran: still just the (none) persisted messages.
      expect(getSessionMessages(env.db, "s1")).toHaveLength(0);
    });

    it("resumes a session after a previous turn failed", async () => {
      const model = streamingModel([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Back again" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
      ]);
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      setSessionStatus(env.db, "s1", "failed");

      const settled = waitForSettled("s1");
      const res = await postMessage(app, "s1", "try again");
      expect(res.status).toBe(200);
      await res.text();
      await settled;

      expect(getSessionMessages(env.db, "s1").map((r) => r.role)).toEqual(["user", "assistant"]);
      expect(getSession(env.db, "s1")?.status).toBe("idle");
    });
  });

  describe("DELETE /api/sessions/:id", () => {
    it("deletes the session and its messages and publishes session.deleted", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "Hi" }] });

      const res = await app.request("/api/sessions/s1", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      expect(getSession(env.db, "s1")).toBeUndefined();
      expect(getSessionMessages(env.db, "s1")).toHaveLength(0);
      expect(events).toContainEqual({ type: "session.deleted", id: "s1" });
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("409s a session with a turn in flight", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      setSessionStatus(env.db, "s1", "running");

      const res = await app.request("/api/sessions/s1", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(409);
      // A rejected delete leaves the session in place.
      expect(getSession(env.db, "s1")?.id).toBe("s1");
    });
  });

  describe("DELETE /api/sessions/:id/messages/:messageId", () => {
    it("truncates the transcript from the message, 204s and publishes session.updated", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "Q1" }] });
      appendMessage(env.db, "s1", { role: "assistant", parts: [{ type: "text", text: "A1" }] });
      const second = appendMessage(env.db, "s1", {
        role: "user",
        parts: [{ type: "text", text: "Q2" }],
      });
      appendMessage(env.db, "s1", { role: "assistant", parts: [{ type: "text", text: "A2" }] });

      const res = await app.request(`/api/sessions/s1/messages/${second.id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      // The edited message and the turn after it are gone; the prior turn stays.
      expect(getSessionMessages(env.db, "s1").map((m) => m.index)).toEqual([0, 1]);
      // A truncate has no follow-up turn to announce it, so the route publishes.
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    });

    it("404s an unknown session", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions/ghost/messages/m1", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("404s a message absent from the session", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const res = await app.request("/api/sessions/s1/messages/ghost", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("409s a session with a turn in flight", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      const message = appendMessage(env.db, "s1", {
        role: "user",
        parts: [{ type: "text", text: "Q1" }],
      });
      setSessionStatus(env.db, "s1", "running");

      const res = await app.request(`/api/sessions/s1/messages/${message.id}`, {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(409);
      // A rejected truncate leaves the transcript in place.
      expect(getSessionMessages(env.db, "s1")).toHaveLength(1);
    });
  });

  describe("POST /api/sessions/:id/cancel", () => {
    it("cancels an in-flight turn", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: pendingModel() }), { bus, cancelRegistry });
      createSession(env.db, MODEL, { id: "s1" });

      // The turn parks (the model stream never closes); start it, then cancel.
      const turn = await postMessage(app, "s1", "Hi there");
      const settled = waitForSettled("s1");
      const cancel = await app.request("/api/sessions/s1/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      await turn.text();
      await settled;

      expect(cancel.status).toBe(202);
      expect((await cancel.json()) as { sessionId: string }).toEqual({ sessionId: "s1" });
      expect(getSession(env.db, "s1")?.status).toBe("cancelled");
    });

    it("404s an unknown session", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = makeApp(fakeClients(), { cancelRegistry });
      const res = await app.request("/api/sessions/ghost/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });

    it("409s when the session is not in flight", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = makeApp(fakeClients(), { cancelRegistry });
      createSession(env.db, MODEL, { id: "s1" });

      const res = await app.request("/api/sessions/s1/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(409);
    });

    it("409s when the session looks running but has no in-flight turn", async () => {
      const cancelRegistry = createCancelRegistry();
      const app = makeApp(fakeClients(), { cancelRegistry });
      createSession(env.db, MODEL, { id: "s1" });
      // Marked running in the DB, but nothing registered with the canceller —
      // the requestCancel miss path.
      setSessionStatus(env.db, "s1", "running");

      const res = await app.request("/api/sessions/s1/cancel", {
        method: "POST",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(409);
    });
  });

  describe("first-party delegate tool", () => {
    // A model that captures the tools and system prompt it was offered, then
    // replies with a short text — for asserting what a turn was armed with.
    const capturingModel = (capture: { toolNames?: string[]; systemText?: string }): LlmModel =>
      new MockLanguageModelV3({
        doStream: async (options) => {
          capture.toolNames = (options.tools ?? []).map((t) => t.name);
          const system = options.prompt.find((m) => m.role === "system");
          capture.systemText = typeof system?.content === "string" ? system.content : "";
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "hi" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
            ]),
          };
        },
      }) as unknown as LlmModel;

    it("offers delegate to a top-level turn and steers research to it", async () => {
      const capture: { toolNames?: string[]; systemText?: string } = {};
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: capturingModel(capture) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "research something")).text();
      await settled;

      expect(capture.toolNames).toContain("delegate");
      expect(capture.systemText).toContain("Delegation is the rule for research");
    });

    it("never offers delegate to a child's own turn, which runs the worker prompt", async () => {
      const capture: { toolNames?: string[]; systemText?: string } = {};
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: capturingModel(capture) }), { bus });
      createSession(env.db, MODEL, { id: "s1" });
      createSession(env.db, MODEL, {
        id: "child",
        parentSessionId: "s1",
        parentToolCallId: "call_1",
      });

      const settled = waitForSettled("child");
      await (await postMessage(app, "child", "follow up on the task")).text();
      await settled;

      expect(capture.toolNames).not.toContain("delegate");
      expect(capture.systemText).toContain("focused assistant");
      expect(capture.systemText).not.toContain("prefer the `delegate` tool");
    });

    it("runs a delegated task in a hidden child session and feeds back only its report", async () => {
      // The one standing-allow MCP tool: the worker may hold it; ask-gated
      // tools and the withheld set must never reach it.
      createToolPermissionStore(env.config.toolPermissionsFile()).set("tavily__search", "allow");
      let childToolNames: string[] = [];
      let call = 0;
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          call += 1;
          // Call order is deterministic: the parent's first step issues the
          // delegate call, its execute drives the child's whole turn (call 2),
          // then the parent's second step answers from the report.
          if (call === 1) {
            return {
              stream: convertArrayToReadableStream([
                {
                  type: "tool-call",
                  toolCallId: "c1",
                  toolName: "delegate",
                  input: '{"title":"Pelican facts","task":"Find pelican facts","effort":"low"}',
                },
                { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
              ]),
            };
          }
          if (call === 2) {
            childToolNames = (options.tools ?? []).map((t) => t.name);
            return {
              stream: convertArrayToReadableStream([
                { type: "text-start", id: "t1" },
                { type: "text-delta", id: "t1", delta: "Pelicans: all good." },
                { type: "text-end", id: "t1" },
                { type: "finish", finishReason: finishReason("stop"), usage: usage(4, 3) },
              ]),
            };
          }
          return {
            stream: convertArrayToReadableStream([
              { type: "text-start", id: "t2" },
              { type: "text-delta", id: "t2", delta: "Summarised." },
              { type: "text-end", id: "t2" },
              { type: "finish", finishReason: finishReason("stop"), usage: usage(6, 2) },
            ]),
          };
        },
      }) as unknown as LlmModel;

      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model }), {
        bus,
        mcpRegistry: fakeMcp({ tavily__search: mcpTool() }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "research pelicans")).text();
      await settled;

      // The parent transcript holds the call with the report as its output,
      // then the model's answer from it.
      const rows = getSessionMessages(env.db, "s1");
      const part = toolPartOf(rows[1]);
      expect(part.type).toBe("tool-delegate");
      expect(part.state).toBe("output-available");
      expect(part.output).toBe("Pelicans: all good.");
      expect(JSON.stringify(rows[1]?.parts)).toContain("Summarised.");

      // The child is linked to the spawning call, ran the task as its own
      // transcript, and settled idle.
      const child = findChildByToolCall(env.db, "s1", "c1");
      expect(child?.status).toBe("idle");
      const childRows = getSessionMessages(env.db, child?.id ?? "");
      expect(childRows.map((r) => r.role)).toEqual(["user", "assistant"]);
      expect(JSON.stringify(childRows[0]?.parts)).toContain("Find pelican facts");

      // Hidden from the list, yet served at its own URL.
      const list = (await (await app.request("/api/sessions")).json()) as {
        sessions: { id: string }[];
      };
      expect(list.sessions.map((s) => s.id)).toEqual(["s1"]);
      expect((await app.request(`/api/sessions/${child?.id}`)).status).toBe(200);

      // The worker held only standing-allow tools: the allowed MCP search and
      // the article and memory reads, never the ask-gated, withheld, or
      // spawning ones.
      expect(childToolNames).toContain("tavily__search");
      expect(childToolNames).toContain("read_article");
      expect(childToolNames).toContain("read_memory");
      expect(childToolNames).not.toContain("delegate");
      expect(childToolNames).not.toContain("create_article");
      expect(childToolNames).not.toContain("save_memory");
      expect(childToolNames).not.toContain("delete_memory");
      expect(childToolNames).not.toContain("run_workflow");
    });
  });

  describe("tool permission prompts", () => {
    const postRaw = (app: ReturnType<typeof createApp>, id: string, message: unknown) =>
      app.request(`/api/sessions/${id}/messages`, {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

    it("pauses an ungranted tool for approval, then runs it when resumed", async () => {
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("linear__create_issue") }), {
        bus,
        mcpRegistry: fakeMcp({ linear__create_issue: mcpTool() }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      // Turn 1: the model calls the ungranted tool, so the turn pauses.
      const firstSettled = waitForSettled("s1");
      await (await postMessage(app, "s1", "open an issue")).text();
      await firstSettled;

      const paused = getSessionMessages(env.db, "s1");
      expect(paused.map((r) => r.role)).toEqual(["user", "assistant"]);
      const pendingTool = toolPartOf(paused[1]);
      expect(pendingTool.state).toBe("approval-requested");
      expect(pendingTool.output).toBeUndefined();
      expect(getSession(env.db, "s1")?.status).toBe("idle");

      // The client re-sends the paused assistant message with the verdict applied.
      const respondedParts = (paused[1]?.parts as ToolPart[]).map((part) =>
        part.state === "approval-requested"
          ? { ...part, state: "approval-responded", approval: { ...part.approval, approved: true } }
          : part,
      );
      const secondSettled = waitForSettled("s1");
      const res = await postRaw(app, "s1", { role: "assistant", parts: respondedParts });
      expect(res.status).toBe(200);
      await res.text();
      await secondSettled;

      const resumed = getSessionMessages(env.db, "s1");
      // The continuation extended the same assistant message; no extra row.
      expect(resumed.map((r) => r.role)).toEqual(["user", "assistant"]);
      expect(toolPartOf(resumed[1]).state).toBe("output-available");
      expect(getSession(env.db, "s1")?.status).toBe("idle");
    });

    it("runs a paused tool granted just before the resume, instead of cancelling it", async () => {
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("linear__create_issue") }), {
        bus,
        mcpRegistry: fakeMcp({ linear__create_issue: mcpTool() }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const firstSettled = waitForSettled("s1");
      await (await postMessage(app, "s1", "open an issue")).text();
      await firstSettled;
      const paused = getSessionMessages(env.db, "s1")[1];

      // "Always allow" records the permission before the resume lands. The AI SDK
      // re-checks approval on resume, so the now-allowed call must still run
      // rather than be denied for no-longer-needing-approval.
      createToolPermissionStore(env.config.toolPermissionsFile()).set(
        "linear__create_issue",
        "allow",
      );
      const respondedParts = (paused?.parts as ToolPart[]).map((part) =>
        part.state === "approval-requested"
          ? { ...part, state: "approval-responded", approval: { ...part.approval, approved: true } }
          : part,
      );

      const secondSettled = waitForSettled("s1");
      await (await postRaw(app, "s1", { role: "assistant", parts: respondedParts })).text();
      await secondSettled;

      expect(toolPartOf(getSessionMessages(env.db, "s1")[1]).state).toBe("output-available");
    });

    it("runs an allowed tool straight through without pausing", async () => {
      createToolPermissionStore(env.config.toolPermissionsFile()).set(
        "linear__create_issue",
        "allow",
      );
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("linear__create_issue") }), {
        bus,
        mcpRegistry: fakeMcp({ linear__create_issue: mcpTool() }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "open an issue")).text();
      await settled;

      // One turn, no pause: the tool ran and the model answered.
      const rows = getSessionMessages(env.db, "s1");
      expect(toolPartOf(rows[1]).state).toBe("output-available");
      expect(getSession(env.db, "s1")?.status).toBe("idle");
    });

    it("409s a new user message while a tool approval is pending", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", {
        role: "user",
        parts: [{ type: "text", text: "open an issue" }],
      });
      appendMessage(env.db, "s1", {
        role: "assistant",
        parts: [
          {
            type: "tool-linear__create_issue",
            toolCallId: "c1",
            state: "approval-requested",
            input: { title: "Bug" },
            approval: { id: "a1" },
          },
        ] as never,
      });

      const res = await postMessage(app, "s1", "never mind");

      expect(res.status).toBe(409);
      // No new turn started — the transcript is unchanged.
      expect(getSessionMessages(env.db, "s1")).toHaveLength(2);
    });

    it("409s an approval resume when nothing is pending", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });
      appendMessage(env.db, "s1", { role: "user", parts: [{ type: "text", text: "hi" }] });

      const res = await postRaw(app, "s1", {
        role: "assistant",
        parts: [
          {
            type: "tool-x",
            toolCallId: "c1",
            state: "approval-responded",
            input: {},
            approval: { id: "a1", approved: true },
          },
        ],
      });

      expect(res.status).toBe(409);
    });

    it("withholds an off tool from the model so it never runs", async () => {
      let ran = false;
      const offTool = tool({
        description: "create an issue",
        inputSchema: z.object({ title: z.string() }),
        execute: async () => {
          ran = true;
          return "created";
        },
      });
      createToolPermissionStore(env.config.toolPermissionsFile()).set(
        "linear__create_issue",
        "off",
      );
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("linear__create_issue") }), {
        bus,
        mcpRegistry: fakeMcp({ linear__create_issue: offTool }),
      });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "open an issue")).text();
      await settled;

      // The tool was never offered, so its executor never ran.
      expect(ran).toBe(false);
    });

    it("pauses run_workflow for approval by default, then runs it when resumed", async () => {
      env.registry.replace(
        new Map([["greet", workflowSchema.parse({ name: "greet", steps: [{ sh: "printf ok" }] })]]),
      );
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(
        fakeClients({ model: toolCallModel("run_workflow", '{"name":"greet"}') }),
        { bus },
      );
      createSession(env.db, MODEL, { id: "s1" });

      // Turn 1: run_workflow executes user scripts, so it pauses like an
      // ungranted MCP tool even though it is first-party.
      const firstSettled = waitForSettled("s1");
      await (await postMessage(app, "s1", "run greet")).text();
      await firstSettled;

      const paused = getSessionMessages(env.db, "s1");
      const pendingTool = toolPartOf(paused[1]);
      expect(pendingTool.state).toBe("approval-requested");
      expect(pendingTool.output).toBeUndefined();

      const respondedParts = (paused[1]?.parts as ToolPart[]).map((part) =>
        part.state === "approval-requested"
          ? { ...part, state: "approval-responded", approval: { ...part.approval, approved: true } }
          : part,
      );
      const secondSettled = waitForSettled("s1");
      await (await postRaw(app, "s1", { role: "assistant", parts: respondedParts })).text();
      await secondSettled;

      const finished = toolPartOf(getSessionMessages(env.db, "s1")[1]);
      expect(finished.state).toBe("output-available");
      expect((finished.output as { status: string }).status).toBe("ok");
    });

    it("runs an allowed run_workflow straight through without pausing", async () => {
      env.registry.replace(
        new Map([["greet", workflowSchema.parse({ name: "greet", steps: [{ sh: "printf ok" }] })]]),
      );
      createToolPermissionStore(env.config.toolPermissionsFile()).set("run_workflow", "allow");
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(
        fakeClients({ model: toolCallModel("run_workflow", '{"name":"greet"}') }),
        { bus },
      );
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "run greet")).text();
      await settled;

      const part = toolPartOf(getSessionMessages(env.db, "s1")[1]);
      expect(part.state).toBe("output-available");
      expect((part.output as { status: string }).status).toBe("ok");
    });

    it("runs list_workflows straight through on its allow default", async () => {
      const { bus, waitForSettled } = createSessionWaiter();
      const app = makeApp(fakeClients({ model: toolCallModel("list_workflows", "{}") }), { bus });
      createSession(env.db, MODEL, { id: "s1" });

      const settled = waitForSettled("s1");
      await (await postMessage(app, "s1", "what workflows are there?")).text();
      await settled;

      // No pause: the list tool only reads kiri's own registry.
      const part = toolPartOf(getSessionMessages(env.db, "s1")[1]);
      expect(part.state).toBe("output-available");
      expect(part.output).toEqual([]);
    });
  });
});
