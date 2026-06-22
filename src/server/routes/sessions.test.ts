import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { type Tool, type ToolSet, tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import { type CancelRegistry, createCancelRegistry } from "../runner/cancel-registry.ts";
import {
  appendMessage,
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
} from "../sessions/index.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// Provider-level (v3) usage; the SDK rolls these into flat input/output/total.
const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finishReason = (unified: "stop") => ({ unified, raw: unified });

const streamingModel = (chunks: LanguageModelV3StreamPart[]): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(chunks) }),
  }) as unknown as LlmModel;

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

// Configurable LlmClients fake. Routes only ever call resolveModel and
// listModels; generateText is interface ballast they never touch.
const fakeClients = (
  opts: {
    model?: LlmModel;
    resolveError?: string;
    models?: { id: string; provider: string }[];
  } = {},
): LlmClients => ({
  resolveModel: () => {
    if (opts.resolveError) throw new Error(opts.resolveError);
    return opts.model ?? (new MockLanguageModelV3({}) as unknown as LlmModel);
  },
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: opts.models ?? [], failures: [] }),
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
    extra: { bus?: EventBus; cancelRegistry?: CancelRegistry; mcpRegistry?: McpRegistry } = {},
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

  // Write a persona file into the test workspace so the persona routes accept it.
  const writePersona = (name: string, body: string) => {
    const dir = join(env.cwd, "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), body);
  };

  describe("GET /api/models", () => {
    it("returns the aggregated model listing", async () => {
      const app = makeApp(
        fakeClients({ models: [{ id: "anthropic:claude", provider: "anthropic" }] }),
      );

      const res = await app.request("/api/models");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [{ id: "anthropic:claude", provider: "anthropic" }],
        failures: [],
      });
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

  describe("GET /api/personas", () => {
    it("returns an empty list when the workspace defines none", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/personas");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ personas: [] });
    });

    it("lists the workspace's personas with humanised names", async () => {
      writePersona("reviewer", "r");
      writePersona("financial-advisor", "f");
      const app = makeApp(fakeClients());

      const res = await app.request("/api/personas");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        personas: [
          { id: "financial-advisor", name: "Financial Advisor" },
          { id: "reviewer", name: "Reviewer" },
        ],
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

    it("400s an unknown cursor", async () => {
      const app = makeApp(fakeClients());
      const res = await app.request("/api/sessions?cursor=nope");
      expect(res.status).toBe(400);
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

    it("attaches a workspace persona and publishes session.updated", async () => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((e) => events.push(e));
      const app = makeApp(fakeClients(), { bus });
      writePersona("code-reviewer", "You are a meticulous code reviewer.");
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchBody(app, "s1", { persona: "code-reviewer" });

      expect(res.status).toBe(200);
      expect(getSession(env.db, "s1")?.persona).toBe("code-reviewer");
      expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    });

    it("detaches the persona when passed null", async () => {
      writePersona("code-reviewer", "rev");
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      await patchBody(app, "s1", { persona: "code-reviewer" });
      expect(getSession(env.db, "s1")?.persona).toBe("code-reviewer");

      const res = await patchBody(app, "s1", { persona: null });
      expect(res.status).toBe(200);
      expect(getSession(env.db, "s1")?.persona).toBeNull();
    });

    it("rejects an unknown persona and leaves it unchanged", async () => {
      const app = makeApp(fakeClients());
      createSession(env.db, MODEL, { id: "s1" });

      const res = await patchBody(app, "s1", { persona: "ghost" });

      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toEqual({ error: 'unknown persona "ghost"' });
      expect(getSession(env.db, "s1")?.persona).toBeNull();
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
      expect(rows[1]?.usage).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });
      const settledSession = getSession(env.db, "s1");
      expect(settledSession?.status).toBe("idle");
      expect(settledSession?.totalTokens).toBe(9);
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
    it("truncates the transcript from the message and 204s", async () => {
      const app = makeApp(fakeClients());
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
});
