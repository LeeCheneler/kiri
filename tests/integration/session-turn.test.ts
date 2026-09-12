import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type UIMessage, tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bootstrap } from "../../src/server/bootstrap.ts";
import { loadKiriConfig } from "../../src/server/config/loader.ts";
import { createConfigStore } from "../../src/server/config/store.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import { articles } from "../../src/server/db/schema.ts";
import {
  type LlmClients,
  createLlmClients,
  createLlmProviderRegistry,
} from "../../src/server/llm/index.ts";
import { createCancelRegistry } from "../../src/server/runner/cancel-registry.ts";
import {
  articleTools,
  createInstructionContext,
  createSession,
  createSystemPromptBuilder,
  filesystemTools,
  getSession,
  getSessionMessages,
  imageTools,
  liveConsoleEmitter,
  resumeTurn,
  runTurn,
  shellTools,
  updateSessionCwd,
  updateSessionImageModel,
} from "../../src/server/sessions/index.ts";
import { FAKE_IMAGE_B64, type FakeOpenAi, startFakeOpenAi } from "../support/fake-openai.ts";

/**
 * Integration coverage for session turns over the *real* streaming stack:
 * `runTurn` → `streamText` → an OpenAI-compatible SSE endpoint → persistence.
 * The route/turn unit tests drive `MockLanguageModelV3` in-process, so this is
 * the only layer that exercises the streamed wire format — and the
 * `include_usage` wiring that otherwise leaves streamed turns with zero tokens.
 */
describe("session turn streaming", () => {
  let fake: FakeOpenAi;
  let cwd: string;
  let db: KiriDb;
  let llmClients: LlmClients;

  beforeAll(() => {
    fake = startFakeOpenAi();
  });

  afterAll(() => {
    fake.stop();
  });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-int-turn-"));
    db = bootstrap(createConfigStore(cwd));
    writeFileSync(
      join(cwd, "kiri.yaml"),
      `providers:\n  fake:\n    type: openai-compatible\n    base_url: ${fake.url}\n`,
    );
    const loaded = loadKiriConfig(createConfigStore(cwd), process.env);
    const registry = createLlmProviderRegistry();
    registry.replace(loaded.providers);
    llmClients = createLlmClients(registry, process.env);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const userMessage = (text: string): UIMessage => ({
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  });

  const assistantText = (parts: unknown): string =>
    (parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");

  it("streams a turn, persisting the user + assistant messages and usage, and settles idle", async () => {
    const session = createSession(db, "fake:echo");

    const { done } = await runTurn(
      { db, llmClients },
      { session, userMessage: userMessage("Hi there") },
    );
    await done;

    const messages = getSessionMessages(db, session.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(assistantText(messages[1].parts)).toBe("You said: Hi there");
    // The context footprint is recorded on the assistant turn — non-zero only
    // because the openai-compatible client opts into `include_usage`.
    expect(messages[1].contextTokens).toBe(20);

    const after = getSession(db, session.id);
    expect(after?.status).toBe("idle");
    expect(after?.finishedAt).toBeNull();
  });

  it("drives a real tool loop over the wire: the model's call runs an article tool and the turn settles", async () => {
    const session = createSession(db, "fake:tool");
    const tools = articleTools(db, session.id, null, () => {});

    // The stub's `tool` model streams back exactly the call the message
    // directs, so this exercises the full loop: streamed tool-call chunks →
    // AI SDK parse/validate → the real create_article execute → result fed
    // back → the follow-up completion.
    const { done } = await runTurn(
      { db, llmClients, tools },
      {
        session,
        userMessage: userMessage(
          `call:create_article ${JSON.stringify({ slug: "notes", content_md: "# Notes\n\nBody." })}`,
        ),
      },
    );
    await done;

    const row = db.select().from(articles).where(eq(articles.sessionId, session.id)).get();
    expect(row?.slug).toBe("notes");
    expect(row?.contentMd).toBe("# Notes\n\nBody.");

    const messages = getSessionMessages(db, session.id);
    expect(assistantText(messages[1].parts)).toBe("All done.");
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it("keeps a completed action after a later provider failure and supplies it to the next turn", async () => {
    let executions = 0;
    const tools = {
      save: tool({
        inputSchema: z.object({ value: z.string() }),
        execute: ({ value }) => {
          executions += 1;
          writeFileSync(join(cwd, "saved.txt"), value);
          return { saved: value };
        },
      }),
    };
    const session = createSession(db, "fake:tool-boom");
    const failed = await runTurn(
      { db, llmClients, tools },
      { session, userMessage: userMessage('call:save {"value":"keep this"}') },
    );
    await failed.done;
    expect(getSession(db, session.id)?.status).toBe("failed");
    const saved = getSessionMessages(db, session.id);
    expect(saved).toHaveLength(2);
    expect(saved[1]?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        output: { saved: "keep this" },
      }),
    );
    expect(await Bun.file(join(cwd, "saved.txt")).text()).toBe("keep this");

    const next = await runTurn(
      { db, llmClients, tools },
      {
        session,
        userMessage: userMessage("Continue from the saved work"),
      },
    );
    await next.done;
    expect(executions).toBe(1);
    expect(getSession(db, session.id)?.status).toBe("idle");
    expect(JSON.stringify(fake.requests.at(-1)?.messages)).toContain("keep this");
    expect(fake.requests.at(-1)?.messages?.some((m) => m.role === "tool")).toBe(true);
  });

  it("compacts a saved result between real streamed model requests", async () => {
    const start = fake.requests.length;
    const session = createSession(db, "fake:tool");
    const evidence = `${"x".repeat(20000)}Original tail`;
    let reads = 0;
    const { response, done } = await runTurn(
      {
        db,
        llmClients: { ...llmClients, contextWindowFor: async () => 8192 },
        tools: {
          read_file: tool({
            inputSchema: z.object({}),
            execute: () => {
              reads += 1;
              return evidence;
            },
          }),
        },
      },
      { session, userMessage: userMessage("call:read_file {}") },
    );
    await response.text();
    await done;
    const requests = fake.requests.slice(start);
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.model)).toEqual(["tool", "tool", "tool"]);
    expect(requests[1]?.stream).not.toBe(true);
    expect(requests[1]?.tools).toBeUndefined();
    expect(requests[1]?.messages?.[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("You are a conversation summariser."),
    });
    expect(JSON.stringify(requests[1]?.messages)).toContain(evidence);
    expect(JSON.stringify(requests[2]?.messages)).toContain("Evidence read once");
    expect(JSON.stringify(requests[2]?.messages)).not.toContain("x".repeat(1000));
    expect(JSON.stringify(getSessionMessages(db, session.id)[1]?.parts)).toContain("Original tail");
    expect(JSON.stringify(getSessionMessages(db, session.id)[1]?.parts)).toContain(
      "data-checkpoint",
    );
    expect(reads).toBe(1);
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it("stops before replaying an action whose result fills the context", async () => {
    const start = fake.requests.length;
    const session = createSession(db, "fake:tool");
    let executions = 0;
    const { response, done } = await runTurn(
      {
        db,
        llmClients: { ...llmClients, contextWindowFor: async () => 8192 },
        tools: {
          save: tool({
            inputSchema: z.object({}),
            execute: () => {
              executions += 1;
              writeFileSync(join(cwd, "context-progress.txt"), "Saved once.");
              return `Saved once.${"x".repeat(100000)}`;
            },
          }),
        },
      },
      { session, userMessage: userMessage("repeat-call:save {}") },
    );
    const sse = await response.text();
    await done;
    expect(executions).toBe(1);
    expect(fake.requests.slice(start)).toHaveLength(1);
    expect(await Bun.file(join(cwd, "context-progress.txt")).text()).toBe("Saved once.");
    expect(sse).toContain("could not free enough working space");
    expect(getSession(db, session.id)).toMatchObject({
      status: "failed",
      error: { code: "context_limit" },
    });
    expect(JSON.stringify(getSessionMessages(db, session.id)[1]?.parts)).toContain("Saved once.");
  });

  it("streams and saves a step-limit handoff after exactly 128 completed actions", async () => {
    const requestStart = fake.requests.length;
    let executions = 0;
    const session = createSession(db, "fake:tool");
    const { response, done } = await runTurn(
      {
        db,
        llmClients,
        tools: {
          save: tool({
            inputSchema: z.object({ value: z.string() }),
            execute: ({ value }) => {
              executions += 1;
              writeFileSync(join(cwd, "progress.txt"), `${value}: ${executions}`);
              return { saved: executions };
            },
          }),
        },
      },
      { session, userMessage: userMessage('repeat-call:save {"value":"completed"}') },
    );
    const sse = await response.text();
    await done;

    expect(executions).toBe(128);
    expect(await Bun.file(join(cwd, "progress.txt")).text()).toBe("completed: 128");
    const requests = fake.requests.slice(requestStart);
    expect(requests).toHaveLength(129);
    expect(requests[127]?.tools).toHaveLength(1);
    expect(requests[128]?.tools ?? []).toEqual([]);
    expect(JSON.stringify(requests[128]?.messages)).toContain(
      "what remains unfinished or uncertain",
    );
    expect(sse).toContain("128-step work limit");
    const streamedText = sse
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; delta: string })
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    expect(streamedText).toContain("The work step limit has been reached.");
    const rows = getSessionMessages(db, session.id);
    expect(rows).toHaveLength(2);
    expect(assistantText(rows[1]?.parts)).toBe(streamedText);
    expect(assistantText(rows[1]?.parts)).toContain("128-step work limit");
    expect(
      (rows[1]?.parts as Array<{ state?: string }>).filter((p) => p.state === "output-available"),
    ).toHaveLength(128);
    expect(getSession(db, session.id)).toMatchObject({
      status: "failed",
      error: { code: "step_limit" },
    });

    db.$client.close();
    db = bootstrap(createConfigStore(cwd));
    expect(assistantText(getSessionMessages(db, session.id)[1]?.parts)).toContain(
      "128-step work limit",
    );
    expect(getSession(db, session.id)?.status).toBe("failed");
  });

  it("drives generate_image over the wire, keeping the image bytes out of the model's context", async () => {
    const session = createSession(db, "fake:tool");
    updateSessionImageModel(db, session.id, "fake:paint");
    const tools = imageTools({ db, sessionId: session.id, llmClients });

    const first = await runTurn(
      { db, llmClients, tools },
      { session, userMessage: userMessage('call:generate_image {"prompt":"a red panda"}') },
    );
    await first.done;

    // The stub generated from the session's selected model with the prompt…
    expect(fake.imageRequests).toMatchObject([{ model: "paint", prompt: "a red panda" }]);

    // …the stored transcript carries the result as a renderable data URL…
    const messages = getSessionMessages(db, session.id);
    const toolPart = (
      messages[1].parts as Array<{
        type: string;
        output?: { image?: string; model?: string; mediaType?: string };
      }>
    ).find((p) => p.type === "tool-generate_image");
    expect(toolPart?.output).toEqual({
      model: "fake:paint",
      mediaType: "image/png",
      image: `data:image/png;base64,${FAKE_IMAGE_B64}`,
    });
    expect(assistantText(messages[1].parts)).toBe("All done.");

    // …and no chat request ever carries the base64 payload: the same-turn
    // follow-up sees toModelOutput's compact form, and the next turn's
    // history is stripped at send time.
    const second = await runTurn(
      { db, llmClients, tools },
      { session: getSession(db, session.id) ?? session, userMessage: userMessage("thanks") },
    );
    await second.done;
    for (const request of fake.requests) {
      expect(JSON.stringify(request)).not.toContain(FAKE_IMAGE_B64);
    }
  });

  it("streams a run_command's live console as transient data parts, persisting none of them", async () => {
    const session = createSession(db, "fake:tool");
    const sessionCwd = { get: () => null, set: () => {} };

    const { response, done } = await runTurn(
      {
        db,
        llmClients,
        // The route threads the turn's writer into the shell tool the same way;
        // this exercises the full path: tool output → coalesced snapshots →
        // the streamed SSE response.
        tools: ({ writer }) =>
          shellTools(() => [cwd], sessionCwd, {
            liveConsole: (toolCallId) => liveConsoleEmitter(writer, toolCallId, { flushMs: 20 }),
          }),
      },
      {
        session,
        userMessage: userMessage(
          `call:run_command ${JSON.stringify({ command: "echo alpha; sleep 0.1; echo beta" })}`,
        ),
      },
    );
    const sse = await response.text();
    await done;

    // Live snapshots rode the wire as transient data parts carrying the
    // growing merge…
    expect(sse).toContain('"type":"data-tool-console"');
    expect(sse).toContain("alpha");
    // …while the persisted assistant message carries only the call and its
    // settled result — the live feed left no trace in storage.
    const messages = getSessionMessages(db, session.id);
    const parts = messages[1].parts as Array<{ type: string; output?: { stdout?: string } }>;
    expect(parts.map((p) => p.type)).not.toContain("data-tool-console");
    expect(parts.find((p) => p.type === "tool-run_command")?.output?.stdout).toBe("alpha\nbeta\n");
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it.each(["parent", "worker", "approval"] as const)(
    "refreshes directory instructions within a %s turn over the real streaming stack",
    async (mode) => {
      const first = join(cwd, "first");
      const second = join(cwd, "second");
      mkdirSync(first);
      mkdirSync(second);
      writeFileSync(join(first, "AGENTS.md"), "Only first-directory work uses this rule.");
      writeFileSync(join(second, "AGENTS.md"), "Only second-directory work uses this rule.");
      const parent = mode === "worker" ? createSession(db, "fake:tool") : null;
      const session = createSession(db, "fake:tool", {
        cwd: realpathSync(first),
        ...(parent ? { parentSessionId: parent.id } : {}),
      });
      const tools = filesystemTools(() => [cwd], {
        get: () => getSession(db, session.id)?.cwd ?? null,
        set: (next) => {
          updateSessionCwd(db, session.id, next);
        },
      });
      if (mode === "approval") tools.set_working_directory.needsApproval = true;
      const deps = {
        db,
        llmClients,
        tools,
        buildSystemPrompt: createSystemPromptBuilder(createConfigStore(cwd), Object.keys(tools), [
          cwd,
        ]),
      };
      const start = fake.requests.length;
      const { done } = await runTurn(deps, {
        session,
        userMessage: userMessage(`call:set_working_directory ${JSON.stringify({ path: second })}`),
      });
      await done;
      if (mode === "approval") {
        expect(getSession(db, session.id)).toMatchObject({
          cwd: realpathSync(first),
          status: "waiting",
        });
        const rows = getSessionMessages(db, session.id);
        const pending = (rows[1]?.parts as Array<{ type: string; toolCallId: string }>).find(
          (part) => part.type === "tool-set_working_directory",
        );
        await (
          await resumeTurn(deps, {
            session: getSession(db, session.id) ?? session,
            approvals: [{ toolCallId: pending?.toolCallId as string, approved: true }],
          })
        ).done;
      }

      const sent = fake.requests.slice(start);
      expect(sent).toHaveLength(2);
      const systems = sent.map(
        (request) => request.messages?.find((message) => message.role === "system")?.content,
      );
      expect(systems[0]).toContain("Only first-directory work uses this rule.");
      expect(systems[0]).not.toContain("Only second-directory work uses this rule.");
      expect(systems[1]).toContain(`The session's working directory is ${realpathSync(second)}`);
      expect(systems[1]).toContain("Only second-directory work uses this rule.");
      expect(systems[1]).not.toContain("Only first-directory work uses this rule.");
      expect(getSession(db, session.id)).toMatchObject({
        cwd: realpathSync(second),
        status: "idle",
      });
    },
  );

  it.each(["parent", "worker"])(
    "delivers nested mutation rules to a %s over the provider wire before any write",
    async (mode) => {
      const nested = join(cwd, "nested");
      mkdirSync(nested);
      writeFileSync(join(nested, "AGENTS.md"), "Nested wire rule.");
      writeFileSync(join(cwd, "kiri.md"), "Inherited workspace rule.");
      const parent = mode === "worker" ? createSession(db, "fake:tool") : null;
      const session = createSession(db, "fake:tool", {
        cwd,
        ...(parent ? { parentSessionId: parent.id } : {}),
      });
      const config = createConfigStore(cwd);
      const project = {
        name: "Project",
        instructions: "Inherited project rule.",
        articles: [],
        memories: [],
      };
      const sources = { config, project, workingDirectory: cwd, allowedDirectories: [cwd] };
      const instructionContext = createInstructionContext(() => sources);
      const tools = filesystemTools(
        () => [cwd],
        {
          get: () => getSession(db, session.id)?.cwd ?? null,
          set: (next) => {
            updateSessionCwd(db, session.id, next);
          },
        },
        {
          checkInstructions: (directory, recursive) =>
            instructionContext.requireForDirectory(directory, { recursive }),
        },
      );
      const start = fake.requests.length;
      await (
        await runTurn(
          {
            db,
            llmClients,
            tools,
            instructionContext,
            buildSystemPrompt: createSystemPromptBuilder(
              config,
              Object.keys(tools),
              [cwd],
              [],
              [],
              [],
              project,
              instructionContext,
            ),
          },
          {
            session,
            userMessage: userMessage(
              'call:write_file {"path":"nested/note.txt","content":"Unchecked."}',
            ),
          },
        )
      ).done;
      const sent = fake.requests.slice(start);
      expect(sent).toHaveLength(2);
      const systems = sent.map(
        (request) => request.messages?.find((message) => message.role === "system")?.content,
      );
      expect(systems[0]).not.toContain("Nested wire rule.");
      expect(systems[1]).toContain("Nested wire rule.");
      for (const system of systems) {
        expect(system).toContain("Inherited workspace rule.");
        expect(system).toContain("Inherited project rule.");
      }
      expect(JSON.stringify(sent[1]?.messages)).toContain("Nothing was changed or started");
      expect(existsSync(join(nested, "note.txt"))).toBe(false);
      expect(getSession(db, session.id)).toMatchObject({ cwd, status: "idle" });
    },
  );

  it.each(["Updated workspace rule.", ""])(
    "refreshes workspace instructions edited to %j without a directory move",
    async (content) => {
      writeFileSync(join(cwd, "kiri.md"), "Original workspace rule.");
      const session = createSession(db, "fake:tool", { cwd });
      const tools = filesystemTools(() => [cwd], {
        get: () => getSession(db, session.id)?.cwd ?? null,
        set: (next) => {
          updateSessionCwd(db, session.id, next);
        },
      });
      const start = fake.requests.length;
      await (
        await runTurn(
          {
            db,
            llmClients,
            tools,
            buildSystemPrompt: createSystemPromptBuilder(
              createConfigStore(cwd),
              Object.keys(tools),
              [cwd],
            ),
          },
          {
            session,
            userMessage: userMessage(
              `call:write_file ${JSON.stringify({ path: "kiri.md", content })}`,
            ),
          },
        )
      ).done;

      const systems = fake.requests
        .slice(start)
        .map((request) => request.messages?.find((message) => message.role === "system")?.content);
      expect(systems).toHaveLength(2);
      expect(systems[0]).toContain("Original workspace rule.");
      expect(systems[1]).not.toContain("Original workspace rule.");
      if (content !== "") expect(systems[1]).toContain(content);
      expect(getSession(db, session.id)?.status).toBe("idle");
    },
  );

  it("composes the layered system prompt — core then kiri.md — and sends it to the model", async () => {
    writeFileSync(join(cwd, "kiri.md"), "Always answer in British English.");
    const session = createSession(db, "fake:echo");

    const { done } = await runTurn(
      { db, llmClients, buildSystemPrompt: createSystemPromptBuilder(createConfigStore(cwd)) },
      { session, userMessage: userMessage("hi") },
    );
    await done;

    const sent = fake.requests[fake.requests.length - 1];
    const system = sent?.messages?.find((m) => m.role === "system");
    const systemText = typeof system?.content === "string" ? system.content : "";
    // Both layers reached the model, in order: core → kiri.md.
    expect(systemText).toContain("running inside kiri");
    expect(systemText).toContain("Always answer in British English.");
    expect(systemText.indexOf("running inside kiri")).toBeLessThan(
      systemText.indexOf("Always answer in British English."),
    );
    // The turn still completed normally with the system prompt in place.
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it("records each turn's context footprint across a multi-turn session", async () => {
    const session = createSession(db, "fake:echo");

    await (await runTurn({ db, llmClients }, { session, userMessage: userMessage("one") })).done;
    const mid = getSession(db, session.id);
    if (!mid) throw new Error("session vanished");
    await (await runTurn({ db, llmClients }, { session: mid, userMessage: userMessage("two") }))
      .done;

    const messages = getSessionMessages(db, session.id);
    expect(messages).toHaveLength(4);
    // Each assistant turn records its own footprint; the latest is what the gauge reads.
    expect(messages[1]?.contextTokens).toBe(20);
    expect(messages[3]?.contextTokens).toBe(20);
  });

  it("records a turn that the provider errors as failed, with the message and no assistant reply", async () => {
    const session = createSession(db, "fake:boom");

    const { done } = await runTurn({ db, llmClients }, { session, userMessage: userMessage("hi") });
    await done;

    const after = getSession(db, session.id);
    expect(after?.status).toBe("failed");
    expect(after?.finishedAt).not.toBeNull();
    expect((after?.error as { message: string }).message).toBeTruthy();
    // The user message is persisted before streaming; the failed turn adds no
    // assistant message.
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual(["user"]);
  });

  it("lands a cancelled turn as cancelled and leaves the session resumable", async () => {
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 50 });
    const session = createSession(db, "fake:slow");

    const { done } = await runTurn(
      { db, llmClients, cancelRegistry },
      { session, userMessage: userMessage("take your time") },
    );
    // The slow model holds the stream open (a lead pause then word-by-word), so
    // the cancel lands mid-flight.
    expect(cancelRegistry.requestCancel(session.id)).toBe(true);
    await done;

    const cancelled = getSession(db, session.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual(["user"]);

    // A cancelled session accepts the next message and runs it clean.
    const resumed = getSession(db, session.id);
    if (!resumed) throw new Error("session vanished");
    await (
      await runTurn(
        { db, llmClients },
        { session: resumed, userMessage: userMessage("back again") },
      )
    ).done;
    const after = getSession(db, session.id);
    expect(after?.status).toBe("idle");
    expect(after?.error).toBeNull();
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual([
      "user",
      "user",
      "assistant",
    ]);
    // The `slow` model's lead pause plus the follow-up turn run past the default
    // per-test budget on a loaded machine; give it headroom.
  }, 15_000);
});
