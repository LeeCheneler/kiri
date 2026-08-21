import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { type UIMessage, tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { CANCELLED_ERROR_TEXT } from "../../shared/cancelled-tool-call.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import { CULLED_RESULT_NOTICE } from "./cull-tool-results.ts";
import { enqueueInboxItem, pendingInboxItems } from "./inbox.ts";
import {
  type Message,
  appendMessage,
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
} from "./store.ts";
import { createStreamRegistry } from "./stream-registry.ts";
import { resumeTurn, runTurn, runWakeTurn } from "./turn.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

const USER_MESSAGE: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Hi there" }],
};

// An LlmClients whose resolveModel always returns `model`, so a turn runs
// against a mock without touching a real provider.
const clientsFor = (model: LlmModel): LlmClients => ({
  resolveModel: () => model,
  resolveImageModel: () => {
    throw new Error("no image model in this fake");
  },
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
  contextWindowFor: async () => undefined,
  reasoningOptionsFor: async () => undefined,
});

// Capturing event bus: records every published event, never delivers.
const recordingBus = (sink: KiriEvent[]) => ({
  publish: (event: KiriEvent) => sink.push(event),
  subscribe: () => () => {},
});

const textParts = (parts: unknown): { type: string; text?: string; state?: string }[] =>
  parts as { type: string; text?: string }[];

// Provider-level (v3) usage carries token sub-totals; the SDK rolls these up
// into the flat input/output/total counts the turn handler persists.
const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finishReason = (unified: "stop" | "error" | "tool-calls") => ({ unified, raw: unified });

const streamingModel = (chunks: LanguageModelV3StreamPart[]): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(chunks) }),
  }) as unknown as LlmModel;

// A model that records the prompt (the converted history) it was handed, then
// answers with a short reply — so a test can assert on exactly what reached it.
const capturingModel = (capture: { prompt?: unknown }): LlmModel =>
  new MockLanguageModelV3({
    doStream: async (options) => {
      capture.prompt = options.prompt;
      return {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: finishReason("stop"), usage: usage(2, 1) },
        ]),
      };
    },
  }) as unknown as LlmModel;

// A stream that emits `parts` then stays open until the turn's abort signal
// fires — then errors like a provider's aborted fetch would. A turn against it
// parks until cancelled, making cancellation deterministic.
const parkedStream = (
  parts: LanguageModelV3StreamPart[],
  abortSignal: AbortSignal | undefined,
): ReadableStream<LanguageModelV3StreamPart> =>
  new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      abortSignal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("The operation was aborted.", "AbortError")),
        { once: true },
      );
    },
  });

// A model whose stream emits a little then stays open: only an abort ends it.
const pendingModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: parkedStream(
        [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hel" },
        ],
        abortSignal,
      ),
    }),
  }) as unknown as LlmModel;

// A model that calls a tool on its first step, then answers on the second once
// the tool result is fed back — the multi-step loop a tool-enabled turn drives.
const toolLoopModel = (): LlmModel => {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      step += 1;
      if (step === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"hi"}' },
            { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Echoed: hi" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: finishReason("stop"), usage: usage(3, 4) },
        ]),
      };
    },
  }) as unknown as LlmModel;
};

// A tool that echoes its input back — stands in for a real tool so the loop can
// be exercised without an external dependency.
const echoTools = {
  echo: tool({
    description: "Echo the value back.",
    inputSchema: z.object({ value: z.string() }),
    execute: async ({ value }: { value: string }) => ({ echoed: value }),
  }),
};

// The same tool, but failing — its thrown message is the model's (and the
// transcript's) recovery instruction.
const failingEchoTools = {
  echo: tool({
    description: "Echo the value back.",
    inputSchema: z.object({ value: z.string() }),
    execute: async (_input: { value: string }): Promise<{ echoed: string }> => {
      throw new Error('no value "hi" — call list_values first.');
    },
  }),
};

// The same tool, but gated behind approval — a call pauses the turn until the
// user allows or denies it, mirroring what `gateTools` does for an ungranted
// MCP tool.
const gatedEchoTools = {
  echo: tool({
    description: "Echo the value back.",
    inputSchema: z.object({ value: z.string() }),
    needsApproval: true,
    execute: async ({ value }: { value: string }) => ({ echoed: value }),
  }),
};

// The single tool part of an assistant message, for asserting its state.
type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  output?: unknown;
  approval?: { id: string; approved?: boolean };
};
const toolPartOf = (row: Message | undefined): ToolPart =>
  (row?.parts as ToolPart[]).find((p) => p.type === "tool-echo") as ToolPart;

describe("runTurn", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes the session's effort as provider options when the model supports reasoning", async () => {
    const capture: { providerOptions?: unknown } = {};
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        capture.providerOptions = options.providerOptions;
        return {
          stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(2, 1) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const askedFor: { id?: string; effort?: string } = {};
    const llmClients: LlmClients = {
      ...clientsFor(model),
      reasoningOptionsFor: async (id, effort) => {
        askedFor.id = id;
        askedFor.effort = effort;
        return { anthropic: { thinking: { type: "enabled", budgetTokens: 16384 } } };
      },
    };
    const session = createSession(db, MODEL, { id: "s1", effort: "high" });

    const { response, done } = await runTurn(
      { db, llmClients },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // The mapping is asked for this session's model at its stored effort, and
    // what it returns rides the model call unchanged.
    expect(askedFor).toEqual({ id: MODEL, effort: "high" });
    expect(capture.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 16384 } },
    });
  });

  it("sends no provider options when the model has no reasoning support", async () => {
    const capture: { providerOptions?: unknown } = {};
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        capture.providerOptions = options.providerOptions;
        return {
          stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(2, 1) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const session = createSession(db, MODEL, { id: "s1", effort: "high" });

    // clientsFor's reasoningOptionsFor resolves undefined — a model the
    // listing doesn't mark reasoning-capable gets no parameters at all.
    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    expect(capture.providerOptions).toBeUndefined();
  });

  it("persists the user and assistant messages and the context footprint on a completed turn", async () => {
    const model = streamingModel([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello" },
      { type: "text-delta", id: "t1", delta: " world" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
    ]);
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model), bus: recordingBus(events) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(textParts(rows[0]?.parts)[0]?.text).toBe("Hi there");
    const assistantText = textParts(rows[1]?.parts).find((p) => p.type === "text")?.text;
    expect(assistantText).toBe("Hello world");
    expect(rows[1]?.contextTokens).toBe(9);

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("idle");

    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "running" });
    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    expect(events.filter((e) => e.type === "session.message.added")).toHaveLength(2);
  });

  it("culls older tool results from what the model sees over the cull ratio, leaving storage intact", async () => {
    const toolResult = (id: string, marker: string): UIMessage["parts"][number] =>
      ({
        type: "tool-search",
        toolCallId: id,
        state: "output-available",
        input: { query: id },
        output: { marker },
      }) as UIMessage["parts"][number];

    const session = createSession(db, MODEL, { id: "s1" });
    // Five tool results across two prior assistant turns; the latest turn's usage
    // puts the session over the cull ratio of the 1000-token window the model
    // reports.
    appendMessage(
      db,
      "s1",
      { role: "user", parts: [{ type: "text", text: "search" }] },
      { id: "u0" },
    );
    appendMessage(
      db,
      "s1",
      { role: "assistant", parts: [toolResult("c1", "ALPHA"), toolResult("c2", "BRAVO")] },
      { id: "a1" },
    );
    appendMessage(
      db,
      "s1",
      {
        role: "assistant",
        parts: [
          toolResult("c3", "CHARLIE"),
          toolResult("c4", "DELTA"),
          toolResult("c5", "ECHO"),
          { type: "text", text: "done" },
        ],
        contextTokens: 900,
      },
      { id: "a2" },
    );

    const capture: { prompt?: unknown } = {};
    const llmClients: LlmClients = {
      ...clientsFor(capturingModel(capture)),
      contextWindowFor: async () => 1000,
      reasoningOptionsFor: async () => undefined,
    };

    const { response, done } = await runTurn(
      { db, llmClients },
      {
        session,
        userMessage: { id: "u1", role: "user", parts: [{ type: "text", text: "again" }] },
      },
    );
    await response.text();
    await done;

    // The two oldest results reach the model as the notice; the three most recent
    // arrive in full.
    const sent = JSON.stringify(capture.prompt);
    expect(sent).toContain(CULLED_RESULT_NOTICE);
    expect(sent).not.toContain("ALPHA");
    expect(sent).not.toContain("BRAVO");
    expect(sent).toContain("CHARLIE");
    expect(sent).toContain("DELTA");
    expect(sent).toContain("ECHO");

    // Storage is untouched: the culled results keep their real output on disk.
    const stored = JSON.stringify(getSessionMessages(db, "s1").find((r) => r.id === "a1")?.parts);
    expect(stored).toContain("ALPHA");
    expect(stored).toContain("BRAVO");
    expect(stored).not.toContain(CULLED_RESULT_NOTICE);
  });

  it("re-encodes a JSON tool result as TOON for the model, leaving storage as JSON", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    // A uniform record array — TOON's sweet spot, so the compact form wins.
    appendMessage(
      db,
      "s1",
      { role: "user", parts: [{ type: "text", text: "search" }] },
      { id: "u0" },
    );
    appendMessage(
      db,
      "s1",
      {
        role: "assistant",
        parts: [
          {
            type: "tool-search",
            toolCallId: "c1",
            state: "output-available",
            input: { query: "q" },
            output: {
              rows: [
                { id: 1, tag: "ZULU" },
                { id: 2, tag: "YANKEE" },
                { id: 3, tag: "XRAY" },
              ],
            },
          },
        ] as UIMessage["parts"],
      },
      { id: "a1" },
    );

    const capture: { prompt?: unknown } = {};
    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(capturingModel(capture)) },
      {
        session,
        userMessage: { id: "u1", role: "user", parts: [{ type: "text", text: "again" }] },
      },
    );
    await response.text();
    await done;

    // The model receives the TOON form — a tabular header naming the fields,
    // which the JSON encoding (quoted keys per row) never produces.
    const sent = JSON.stringify(capture.prompt);
    expect(sent).toContain("rows[3]{id,tag}");
    expect(sent).not.toContain('"tag":"ZULU"');

    // Storage is untouched: the stored result keeps its JSON, not the TOON.
    const stored = JSON.stringify(getSessionMessages(db, "s1").find((r) => r.id === "a1")?.parts);
    expect(stored).toContain('"tag":"ZULU"');
    expect(stored).not.toContain("rows[3]{id,tag}");
  });

  it("drops a write result's diff for the model, leaving it in storage", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    appendMessage(
      db,
      "s1",
      { role: "user", parts: [{ type: "text", text: "edit" }] },
      { id: "u0" },
    );
    appendMessage(
      db,
      "s1",
      {
        role: "assistant",
        parts: [
          {
            type: "tool-edit_file",
            toolCallId: "c1",
            state: "output-available",
            input: { path: "/ws/a.md", old_string: "OLDLINE", new_string: "NEWLINE" },
            output: {
              path: "/ws/a.md",
              replacements: 1,
              diff: "@@ -1,1 +1,1 @@\n-OLDLINE\n+NEWLINE",
            },
          },
        ] as UIMessage["parts"],
      },
      { id: "a1" },
    );

    const capture: { prompt?: unknown } = {};
    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(capturingModel(capture)) },
      {
        session,
        userMessage: { id: "u1", role: "user", parts: [{ type: "text", text: "again" }] },
      },
    );
    await response.text();
    await done;

    // The model sees the compact metadata; the diff — already implied by the
    // call's input — never reaches it from history.
    const sent = JSON.stringify(capture.prompt);
    expect(sent).toContain("/ws/a.md");
    expect(sent).not.toContain("@@ -1,1");

    // Storage keeps the diff for the app's transcript rendering.
    const stored = JSON.stringify(getSessionMessages(db, "s1").find((r) => r.id === "a1")?.parts);
    expect(stored).toContain("@@ -1,1");
  });

  it("rejects before persisting anything when the model cannot be resolved", async () => {
    const llmClients: LlmClients = {
      resolveModel: () => {
        throw new Error('unknown llm provider "anthropic"');
      },
      resolveImageModel: () => {
        throw new Error('unknown llm provider "anthropic"');
      },
      generateText: async () => ({ text: "", usage: {} }),
      listModels: async () => ({ models: [], failures: [] }),
      contextWindowFor: async () => undefined,
      reasoningOptionsFor: async () => undefined,
    };
    const session = createSession(db, MODEL, { id: "s1" });

    await expect(
      runTurn({ db, llmClients }, { session, userMessage: USER_MESSAGE }),
    ).rejects.toThrow('unknown llm provider "anthropic"');

    expect(getSessionMessages(db, "s1")).toHaveLength(0);
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("marks the session failed and records the error when the stream errors", async () => {
    const model = streamingModel([
      { type: "error", error: "rate limited" },
      { type: "finish", finishReason: finishReason("error"), usage: usage(1, 0) },
    ]);
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model), bus: recordingBus(events) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toEqual({ message: "rate limited" });
    expect(settled?.finishedAt).toBeInstanceOf(Date);
    // The user message persisted; no assistant message was appended.
    expect(getSessionMessages(db, "s1").map((r) => r.role)).toEqual(["user"]);
    expect(events).toContainEqual({ type: "session.finished", id: "s1", status: "failed" });
  });

  it("cancels an in-flight turn when the registry requests it", async () => {
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(pendingModel()), bus: recordingBus(events), cancelRegistry },
      { session, userMessage: USER_MESSAGE },
    );
    // The stream never closes on its own; the cancel aborts it, ending the turn.
    // Let the opening delta flow through first — as it has by the time a user
    // reaches for cancel.
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("cancelled");
    expect(settled?.finishedAt).toBeInstanceOf(Date);
    // The text streamed before the cancel is kept, so the interrupted turn is
    // still there for the next one (and a reload) rather than vanishing.
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(textParts(rows[1]?.parts)).toEqual([
      { type: "step-start" },
      { type: "text", text: "Hel", state: "streaming" },
    ]);
    // No footprint: the aborted stream never settles its usage.
    expect(rows[1]?.contextTokens).toBeNull();
    expect(events).toContainEqual({ type: "session.message.added", sessionId: "s1" });
    expect(events).toContainEqual({ type: "session.finished", id: "s1", status: "cancelled" });
  });

  it("holds the resumable stream while a turn is in flight and drops it when it settles", async () => {
    const streamRegistry = createStreamRegistry();
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(pendingModel()), streamRegistry, cancelRegistry },
      { session, userMessage: USER_MESSAGE },
    );
    // The turn parks; its stream is registered so a reconnecting client can rejoin.
    expect(streamRegistry.has("s1")).toBe(true);

    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    // Settling drops the entry in step with persistence, so a client that loads
    // the now-settled turn from storage gets a 204 and can't replay a duplicate.
    expect(streamRegistry.has("s1")).toBe(false);
  });

  it("completes and persists when the client never reads the response", async () => {
    // No consumer reads the streamed response — the client navigated away,
    // reloaded, or dropped the connection. The turn is drained server-side, so
    // it still runs to completion, persists, and settles `idle` rather than
    // being cancelled.
    const model = streamingModel([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
    ]);
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { done } = await runTurn(
      { db, llmClients: clientsFor(model), bus: recordingBus(events) },
      { session, userMessage: USER_MESSAGE },
    );
    // Deliberately never read `response`; only the server-side drain advances it.
    await done;

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(textParts(rows[1]?.parts).find((p) => p.type === "text")?.text).toBe("Hello");
    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
  });

  it("resumes a session after a failed turn, clearing the prior error", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    setSessionStatus(db, "s1", "failed", { error: { message: "boom" }, finishedAt: new Date() });
    const model = streamingModel([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello again" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: finishReason("stop"), usage: usage(7, 2) },
    ]);

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("idle");
    expect(settled?.error).toBeNull();
    expect(settled?.finishedAt).toBeNull();
  });

  it("drives a tool loop, persisting the tool call, its result, and the final text", async () => {
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(toolLoopModel()), tools: echoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);

    const parts = rows[1]?.parts as Array<{
      type: string;
      text?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
    }>;
    const toolPart = parts.find((p) => p.type === "tool-echo");
    expect(toolPart?.state).toBe("output-available");
    expect(toolPart?.input).toEqual({ value: "hi" });
    expect(toolPart?.output).toEqual({ echoed: "hi" });
    expect(parts.find((p) => p.type === "text")?.text).toBe("Echoed: hi");

    // The context footprint is the last step alone (3+4), not the summed total.
    expect(rows[1]?.contextTokens).toBe(7);
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("builds a tools factory against the turn's stream writer", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    let writer: unknown;

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(toolLoopModel()),
        tools: (context) => {
          writer = context.writer;
          return echoTools;
        },
      },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // The factory ran with a live writer, and its tools drove the loop as a
    // plain set would.
    expect(typeof (writer as { write?: unknown })?.write).toBe("function");
    const rows = getSessionMessages(db, "s1");
    expect(toolPartOf(rows[1]).output).toEqual({ echoed: "hi" });
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("marks the session failed when the tools factory throws", async () => {
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(toolLoopModel()),
        bus: recordingBus(events),
        tools: () => {
          throw new Error("tool construction broke");
        },
      },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toEqual({ message: "tool construction broke" });
    // The user message persisted; no assistant message was appended.
    expect(getSessionMessages(db, "s1").map((r) => r.role)).toEqual(["user"]);
    expect(events).toContainEqual({ type: "session.finished", id: "s1", status: "failed" });
  });

  it("persists a failed tool call's real message as its errorText", async () => {
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(toolLoopModel()), tools: failingEchoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const rows = getSessionMessages(db, "s1");
    const parts = rows[1]?.parts as Array<{ type: string; state?: string; errorText?: string }>;
    const toolPart = parts.find((p) => p.type === "tool-echo");
    expect(toolPart?.state).toBe("output-error");
    // The thrown message reaches the transcript, not the SDK's masked
    // "An error occurred." default — it names the recovery, and the user
    // should see the same thing the model acts on.
    expect(toolPart?.errorText).toBe('no value "hi" — call list_values first.');
    // A tool error doesn't fail the turn: the model read it and answered.
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("pauses for tool approval instead of running the tool, settling waiting", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    const events: KiriEvent[] = [];

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(toolLoopModel()),
        bus: recordingBus(events),
        tools: gatedEchoTools,
      },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    const toolPart = toolPartOf(rows[1]);
    // The call was recorded awaiting approval — not executed.
    expect(toolPart.state).toBe("approval-requested");
    expect(toolPart.output).toBeUndefined();
    expect(typeof toolPart.approval?.id).toBe("string");
    // The session is waiting — blocked on the user's decision, not resting —
    // and the bus said so, so lists flip amber live.
    expect(getSession(db, "s1")?.status).toBe("waiting");
    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "waiting" });
  });

  it("runs the tool and answers when a paused turn is resumed with approval", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    const clients = clientsFor(toolLoopModel());

    const first = await runTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await first.response.text();
    await first.done;
    const paused = toolPartOf(getSessionMessages(db, "s1")[1]);

    const second = await resumeTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      {
        session,
        approvals: [{ toolCallId: paused.toolCallId as string, approved: true }],
      },
    );
    await second.response.text();
    await second.done;

    const rows = getSessionMessages(db, "s1");
    // The continuation extended the same two rows — no extra assistant message.
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    const toolPart = toolPartOf(rows[1]);
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toEqual({ echoed: "hi" });
    expect(textParts(rows[1]?.parts).find((p) => p.type === "text")?.text).toBe("Echoed: hi");
    expect(getSession(db, "s1")?.status).toBe("idle");
    // The context footprint is the resumed step's alone (3+4), replacing the
    // paused step's.
    expect(rows[1]?.contextTokens).toBe(7);
  });

  it("refuses the tool and lets the model continue when resumed with a denial", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    const clients = clientsFor(toolLoopModel());

    const first = await runTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await first.response.text();
    await first.done;
    const paused = toolPartOf(getSessionMessages(db, "s1")[1]);

    const second = await resumeTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      {
        session,
        approvals: [{ toolCallId: paused.toolCallId as string, approved: false }],
      },
    );
    await second.response.text();
    await second.done;

    const toolPart = toolPartOf(getSessionMessages(db, "s1")[1]);
    // Denied: the tool never ran, and the model carried on to its answer.
    expect(toolPart.state).toBe("output-denied");
    expect(toolPart.output).toBeUndefined();
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("tells the model why a denied tool was refused, so it can move on", async () => {
    let resumedPrompt: unknown;
    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        step += 1;
        if (step === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"hi"}' },
              { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
            ]),
          };
        }
        resumedPrompt = options.prompt;
        return {
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Understood." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const session = createSession(db, MODEL, { id: "s1" });
    const clients = clientsFor(model);

    const first = await runTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await first.response.text();
    await first.done;
    const paused = toolPartOf(getSessionMessages(db, "s1")[1]);

    const second = await resumeTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, approvals: [{ toolCallId: paused.toolCallId as string, approved: false }] },
    );
    await second.response.text();
    await second.done;

    // The continuation prompt carries the denial reason back to the model.
    expect(JSON.stringify(resumedPrompt)).toContain("denied permission to run this tool");
  });

  it("rejects a resume when the session has no turn awaiting approval", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "hi" }] });

    await expect(
      resumeTurn(
        { db, llmClients: clientsFor(streamingModel([])) },
        { session, approvals: [{ toolCallId: "c1", approved: true }] },
      ),
    ).rejects.toThrow(/awaiting tool approval/);
  });

  it("rejects a resume whose verdict matches no pending request", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [
        {
          type: "tool-echo",
          toolCallId: "c1",
          state: "approval-requested",
          input: { value: "hi" },
          approval: { id: "a1" },
        },
      ] as UIMessage["parts"],
    });

    await expect(
      resumeTurn(
        { db, llmClients: clientsFor(streamingModel([])) },
        { session, approvals: [{ toolCallId: "does-not-exist", approved: true }] },
      ),
    ).rejects.toThrow(/no pending tool approval matching/);
  });

  it("sends the composed system prompt to the model when a builder is provided", async () => {
    let captured: unknown;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        captured = options.prompt;
        return {
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hi" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model), buildSystemPrompt: () => "SYSTEM-UNDER-TEST" },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // The builder's output reaches the provider as a system message.
    expect(JSON.stringify(captured)).toContain("SYSTEM-UNDER-TEST");
  });

  it("sends no system message when no builder is provided", async () => {
    let captured: unknown;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        captured = options.prompt;
        return {
          stream: convertArrayToReadableStream([
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hi" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: finishReason("stop"), usage: usage(1, 1) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(model) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    const roles = (captured as { role: string }[]).map((m) => m.role);
    expect(roles).not.toContain("system");
  });
});

describe("cancelled turns keep their progress", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-cancel-"));
    db = openDatabase(join(dir, "kiri.db"));
    migrate(db);
  });
  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // A model that calls `slow` on its first step. The tool parks until the turn's
  // abort signal fires, so a cancel lands mid-execution — the shape of stopping
  // an assistant partway through a long command.
  const slowCallModel = (): LlmModel =>
    streamingModel([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Running it now." },
      { type: "text-end", id: "t1" },
      { type: "tool-call", toolCallId: "c1", toolName: "slow", input: '{"value":"hi"}' },
      { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
    ]);
  const slowTools = {
    slow: tool({
      description: "Take a while.",
      inputSchema: z.object({ value: z.string() }),
      execute: (_input: { value: string }, { abortSignal }) =>
        new Promise<{ echoed: string }>((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    }),
  };
  const slowPartOf = (row: Message | undefined): ToolPart & { errorText?: string } =>
    (row?.parts as (ToolPart & { errorText?: string })[]).find(
      (p) => p.type === "tool-slow",
    ) as ToolPart & { errorText?: string };

  it("persists a tool call cancelled mid-execution as a cancelled result", async () => {
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(slowCallModel()), cancelRegistry, tools: slowTools },
      { session, userMessage: USER_MESSAGE },
    );
    // Give the loop a tick to issue the call and start the tool before cancelling.
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    expect(getSession(db, "s1")?.status).toBe("cancelled");
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    // The text before the call survives, and the call itself is closed out as
    // cancelled — every issued call carries a result the model can be re-sent.
    expect(textParts(rows[1]?.parts)).toContainEqual({
      type: "text",
      text: "Running it now.",
      state: "done",
    });
    const part = slowPartOf(rows[1]);
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe(CANCELLED_ERROR_TEXT);
  });

  it("sends the interrupted work back to the model on the next turn", async () => {
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const session = createSession(db, MODEL, { id: "s1" });

    const first = await runTurn(
      { db, llmClients: clientsFor(slowCallModel()), cancelRegistry, tools: slowTools },
      { session, userMessage: USER_MESSAGE },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await first.response.text();
    await first.done;

    const capture: { prompt?: unknown } = {};
    const second = await runTurn(
      { db, llmClients: clientsFor(capturingModel(capture)), tools: slowTools },
      {
        session,
        userMessage: { id: "u2", role: "user", parts: [{ type: "text", text: "no, stop" }] },
      },
    );
    await second.response.text();
    await second.done;

    // The model sees its own partial turn — the text, the call it issued, and a
    // result telling it the call was cancelled — then the correction. Every
    // tool call is paired with a result, so the provider accepts the history.
    const prompt = capture.prompt as { role: string; content: unknown[] }[];
    expect(prompt.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    const assistant = prompt[1]?.content as { type: string; text?: string; toolCallId?: string }[];
    expect(assistant).toContainEqual({ type: "text", text: "Running it now." });
    expect(assistant.some((c) => c.type === "tool-call" && c.toolCallId === "c1")).toBe(true);
    const result = (prompt[2]?.content as { toolCallId: string; output: { value: string } }[])[0];
    expect(result?.toolCallId).toBe("c1");
    expect(result?.output.value).toBe(CANCELLED_ERROR_TEXT);
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("persists nothing when the cancel lands before the model produced anything", async () => {
    // A stream that opens a text part and parks before any of it arrives:
    // nothing worth keeping.
    const silentModel = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => ({
        stream: parkedStream([{ type: "text-start", id: "t1" }], abortSignal),
      }),
    }) as unknown as LlmModel;
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(silentModel), bus: recordingBus(events), cancelRegistry },
      { session, userMessage: USER_MESSAGE },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    expect(getSession(db, "s1")?.status).toBe("cancelled");
    expect(getSessionMessages(db, "s1").map((r) => r.role)).toEqual(["user"]);
    // Only the user message's own added-event; no second one for a kept reply.
    expect(events.filter((e) => e.type === "session.message.added")).toHaveLength(1);
  });

  it("updates the paused message in place when an approval resume is cancelled", async () => {
    // First step: the model calls a gated `slow` tool, so the turn pauses for
    // approval. Allowing it starts the tool; cancelling mid-run must land on
    // the same assistant row the pause left, keeping its recorded footprint.
    const gatedSlowTools = {
      slow: tool({ ...slowTools.slow, needsApproval: true }),
    };
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const session = createSession(db, MODEL, { id: "s1" });
    const clients = clientsFor(slowCallModel());

    const first = await runTurn(
      { db, llmClients: clients, cancelRegistry, tools: gatedSlowTools },
      { session, userMessage: USER_MESSAGE },
    );
    await first.response.text();
    await first.done;
    const paused = getSessionMessages(db, "s1")[1];
    expect(slowPartOf(paused).state).toBe("approval-requested");
    expect(paused?.contextTokens).toBe(6);

    const second = await resumeTurn(
      { db, llmClients: clients, cancelRegistry, tools: gatedSlowTools },
      { session, approvals: [{ toolCallId: "c1", approved: true }] },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await second.response.text();
    await second.done;

    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(rows[1]?.id).toBe(paused?.id);
    expect(slowPartOf(rows[1]).state).toBe("output-error");
    expect(slowPartOf(rows[1]).errorText).toBe(CANCELLED_ERROR_TEXT);
    // The footprint the pause recorded is left alone — a cancel has none.
    expect(rows[1]?.contextTokens).toBe(6);
    expect(getSession(db, "s1")?.status).toBe("cancelled");
  });
});

describe("session inbox in turns", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-inbox-"));
    db = openDatabase(join(dir, "kiri.db"));
    migrate(db);
  });
  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const MID_TURN_TEXT = "also check X";

  // An echo tool that queues an inbox message during its first execution — the
  // shape of a user sending a message while a tool call is in flight.
  const enqueueingTools = (sessionId: string) => {
    let calls = 0;
    return {
      echo: tool({
        description: "Echo the value back.",
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }: { value: string }) => {
          calls += 1;
          if (calls === 1) {
            enqueueInboxItem(db, sessionId, { source: "user", text: MID_TURN_TEXT });
          }
          return { echoed: value };
        },
      }),
    };
  };

  // A model that runs two tool steps then answers, capturing each step's
  // prompt so the injection point (and its re-insertion) can be asserted.
  const threeStepModel = (prompts: unknown[]): LlmModel =>
    new MockLanguageModelV3({
      doStream: async (options) => {
        prompts.push(options.prompt);
        if (prompts.length === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"one"}' },
              { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
            ]),
          };
        }
        if (prompts.length === 2) {
          return {
            stream: convertArrayToReadableStream([
              { type: "tool-call", toolCallId: "c2", toolName: "echo", input: '{"value":"two"}' },
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

  const occurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;

  it("delivers a mid-turn message at the next step boundary, into stream and transcript", async () => {
    const prompts: unknown[] = [];
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(threeStepModel(prompts)),
        bus: recordingBus(events),
        tools: enqueueingTools("s1"),
      },
      { session, userMessage: USER_MESSAGE },
    );
    const streamed = await response.text();
    await done;

    // Step 1 ran before the message existed; steps 2 and 3 both carry it —
    // re-inserted each step, delivered (and framed) exactly once per prompt.
    expect(occurrences(JSON.stringify(prompts[0]), MID_TURN_TEXT)).toBe(0);
    expect(occurrences(JSON.stringify(prompts[1]), MID_TURN_TEXT)).toBe(1);
    expect(occurrences(JSON.stringify(prompts[2]), MID_TURN_TEXT)).toBe(1);

    // The delivery rides the live response stream as its data part — a
    // watching client renders the interjection mid-turn at the boundary it
    // happened, not only after a reload of the persisted turn.
    expect(streamed).toContain('"type":"data-inbox"');
    expect(streamed).toContain(MID_TURN_TEXT);
    const stepTwo = prompts[1] as { role: string; content: unknown }[];
    const injected = stepTwo.find((m) => JSON.stringify(m.content).includes(MID_TURN_TEXT));
    expect(injected?.role).toBe("user");
    // Injected after the tool result it interrupted — the end of the step-two
    // prompt, not somewhere back in history.
    expect(stepTwo.at(-1)).toBe(injected as (typeof stepTwo)[number]);

    // The persisted turn carries the delivery where the model saw it: after
    // step one's tool call, before step two begins.
    const rows = getSessionMessages(db, "s1");
    const types = (rows[1]?.parts as { type: string }[]).map((p) => p.type);
    const inboxIndex = types.indexOf("data-inbox");
    expect(inboxIndex).toBeGreaterThan(types.indexOf("tool-echo"));
    expect(inboxIndex).toBeLessThan(types.indexOf("step-start", inboxIndex));
    expect(types.filter((t) => t === "data-inbox")).toHaveLength(1);

    // Delivered means delivered: the backlog is empty and the bus said so.
    expect(pendingInboxItems(db, "s1")).toEqual([]);
    expect(events).toContainEqual({ type: "session.inbox.delivered", sessionId: "s1" });
    expect(getSession(db, "s1")?.status).toBe("idle");
  });

  it("replays a woven delivery to later turns as the user message the live turn saw", async () => {
    const session = createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "user", parts: [{ type: "text", text: "start" }] });
    appendMessage(db, "s1", {
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "before the interjection" },
        {
          type: "data-inbox",
          id: "i1",
          data: { source: "user", text: MID_TURN_TEXT, queuedAt: 1 },
        },
        { type: "step-start" },
        { type: "text", text: "after the interjection" },
      ] as UIMessage["parts"],
    });

    const capture: { prompt?: unknown } = {};
    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(capturingModel(capture)) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // The stored assistant message splits around the delivery: what streamed
    // before it, the framed user message, then what streamed after.
    const messages = capture.prompt as { role: string; content: unknown }[];
    const interjection = messages.findIndex((m) =>
      JSON.stringify(m.content).includes(MID_TURN_TEXT),
    );
    const before = messages.findIndex((m) =>
      JSON.stringify(m.content).includes("before the interjection"),
    );
    const after = messages.findIndex((m) =>
      JSON.stringify(m.content).includes("after the interjection"),
    );
    expect(messages[interjection]?.role).toBe("user");
    expect(JSON.stringify(messages[interjection]?.content)).toContain("while you were working");
    expect(before).toBeLessThan(interjection);
    expect(interjection).toBeLessThan(after);
    expect(messages[before]?.role).toBe("assistant");
    expect(messages[after]?.role).toBe("assistant");
  });

  it("drains messages queued while the session was idle ahead of the next turn", async () => {
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });
    enqueueInboxItem(db, "s1", { source: "user", text: "first while idle" });
    enqueueInboxItem(db, "s1", { source: "user", text: "second while idle" });

    const capture: { prompt?: unknown } = {};
    const { response, done } = await runTurn(
      { db, llmClients: clientsFor(capturingModel(capture)), bus: recordingBus(events) },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // Each queued message becomes its own user row, in arrival order, ahead of
    // the message that started the turn.
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "user", "user", "assistant"]);
    expect((rows[0]?.parts as { type: string }[])[0]?.type).toBe("data-inbox");
    expect(JSON.stringify(rows[0]?.parts)).toContain("first while idle");
    expect(JSON.stringify(rows[1]?.parts)).toContain("second while idle");
    expect(JSON.stringify(rows[2]?.parts)).toContain("Hi there");

    // The model reads them framed as queued-while-idle, before the new message.
    const prompt = JSON.stringify(capture.prompt);
    expect(prompt).toContain("while no turn was running");
    expect(prompt.indexOf("first while idle")).toBeLessThan(prompt.indexOf("second while idle"));
    expect(prompt.indexOf("second while idle")).toBeLessThan(prompt.indexOf("Hi there"));

    expect(pendingInboxItems(db, "s1")).toEqual([]);
    expect(events).toContainEqual({ type: "session.inbox.delivered", sessionId: "s1" });
  });

  it("keeps a mid-turn message queued when the turn fails before persisting", async () => {
    let step = 0;
    const failingSecondStep = new MockLanguageModelV3({
      doStream: async () => {
        step += 1;
        if (step === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"one"}' },
              { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
            ]),
          };
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "error", error: "rate limited" },
            { type: "finish", finishReason: finishReason("error"), usage: usage(1, 0) },
          ]),
        };
      },
    }) as unknown as LlmModel;
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(failingSecondStep),
        bus: recordingBus(events),
        tools: enqueueingTools("s1"),
      },
      { session, userMessage: USER_MESSAGE },
    );
    await response.text();
    await done;

    // The failed turn persisted nothing, so the delivery is rolled back to the
    // backlog for the next turn rather than lost with the discarded work.
    expect(getSession(db, "s1")?.status).toBe("failed");
    expect(getSessionMessages(db, "s1").map((r) => r.role)).toEqual(["user"]);
    expect(pendingInboxItems(db, "s1").map((i) => i.text)).toEqual([MID_TURN_TEXT]);
    expect(events).not.toContainEqual({ type: "session.inbox.delivered", sessionId: "s1" });
  });

  it("keeps a delivery in a cancelled turn's kept parts", async () => {
    let step = 0;
    const cancelledSecondStep = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => {
        step += 1;
        if (step === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"one"}' },
              { type: "finish", finishReason: finishReason("tool-calls"), usage: usage(5, 1) },
            ]),
          };
        }
        return { stream: parkedStream([], abortSignal) };
      },
    }) as unknown as LlmModel;
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 20 });
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const { response, done } = await runTurn(
      {
        db,
        llmClients: clientsFor(cancelledSecondStep),
        bus: recordingBus(events),
        cancelRegistry,
        tools: enqueueingTools("s1"),
      },
      { session, userMessage: USER_MESSAGE },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    // The kept partial turn still carries the delivery, and the backlog is
    // cleared — the message is in the transcript, not lost with the cancel.
    expect(getSession(db, "s1")?.status).toBe("cancelled");
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(rows[1]?.parts)).toContain(MID_TURN_TEXT);
    expect(pendingInboxItems(db, "s1")).toEqual([]);
    expect(events).toContainEqual({ type: "session.inbox.delivered", sessionId: "s1" });
  });

  it("delivers into an approval resume after the paused step's tool call", async () => {
    const clients = clientsFor(toolLoopModel());
    const session = createSession(db, MODEL, { id: "s1" });

    const first = await runTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, userMessage: USER_MESSAGE },
    );
    await first.response.text();
    await first.done;
    // While the turn waits on the approval, a message queues.
    enqueueInboxItem(db, "s1", { source: "user", text: MID_TURN_TEXT });
    const paused = toolPartOf(getSessionMessages(db, "s1")[1]);

    const second = await resumeTurn(
      { db, llmClients: clients, tools: gatedEchoTools },
      { session, approvals: [{ toolCallId: paused.toolCallId as string, approved: true }] },
    );
    await second.response.text();
    await second.done;

    // The continuation extended the paused message; the delivery is woven in
    // after the paused step's tool call rather than ahead of the whole turn.
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    const types = (rows[1]?.parts as { type: string }[]).map((p) => p.type);
    const inboxIndex = types.indexOf("data-inbox");
    expect(inboxIndex).toBeGreaterThan(types.indexOf("tool-echo"));
    expect(types.filter((t) => t === "data-inbox")).toHaveLength(1);
    expect(pendingInboxItems(db, "s1")).toEqual([]);
    expect(getSession(db, "s1")?.status).toBe("idle");
  });
});

describe("runWakeTurn", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-wake-"));
    db = openDatabase(join(dir, "kiri.db"));
    migrate(db);
  });
  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens a turn with the drained backlog and no fresh user message", async () => {
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });
    // Real sender sessions: the framing names each worker by resolving its
    // live title at send time.
    createSession(db, MODEL, { id: "w1", title: "CVE scan" });
    createSession(db, MODEL, { id: "w2", title: "Docs sweep" });
    enqueueInboxItem(db, "s1", { source: "child", fromSessionId: "w1", text: "the report" });
    enqueueInboxItem(db, "s1", { source: "child", fromSessionId: "w2", text: "another" });

    const capture: { prompt?: unknown } = {};
    const started = await runWakeTurn(
      { db, llmClients: clientsFor(capturingModel(capture)), bus: recordingBus(events) },
      { session },
    );
    await started?.response.text();
    await started?.done;

    // The drained messages are the whole opening: two user rows, then the reply.
    const rows = getSessionMessages(db, "s1");
    expect(rows.map((r) => r.role)).toEqual(["user", "user", "assistant"]);
    expect((rows[0]?.parts as { type: string }[])[0]?.type).toBe("data-inbox");
    const prompt = JSON.stringify(capture.prompt);
    expect(prompt).toContain('Your delegated worker \\"CVE scan\\" sent this message');
    expect(prompt.indexOf("the report")).toBeLessThan(prompt.indexOf("another"));

    expect(pendingInboxItems(db, "s1")).toEqual([]);
    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(events).toContainEqual({ type: "session.inbox.delivered", sessionId: "s1" });
    expect(events).toContainEqual({ type: "session.message.added", sessionId: "s1" });
    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "running" });
  });

  it("returns null and touches nothing when the backlog is already drained", async () => {
    const events: KiriEvent[] = [];
    const session = createSession(db, MODEL, { id: "s1" });

    const started = await runWakeTurn(
      { db, llmClients: clientsFor(capturingModel({})), bus: recordingBus(events) },
      { session },
    );

    expect(started).toBeNull();
    expect(getSessionMessages(db, "s1")).toEqual([]);
    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(events).toEqual([]);
  });

  it("clears a failed session's terminal markers, like any resumed turn", async () => {
    createSession(db, MODEL, { id: "s1" });
    setSessionStatus(db, "s1", "failed", {
      error: { message: "provider down" },
      finishedAt: new Date(),
    });
    enqueueInboxItem(db, "s1", { source: "child", text: "done anyway" });

    const started = await runWakeTurn(
      { db, llmClients: clientsFor(capturingModel({})) },
      { session: getSession(db, "s1") as NonNullable<ReturnType<typeof getSession>> },
    );
    await started?.response.text();
    await started?.done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("idle");
    expect(settled?.error).toBeNull();
  });
});
