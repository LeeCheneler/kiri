import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { type UIMessage, tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import {
  type Message,
  appendMessage,
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
} from "./store.ts";
import { resumeTurn, runTurn } from "./turn.ts";

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
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
});

// Capturing event bus: records every published event, never delivers.
const recordingBus = (sink: KiriEvent[]) => ({
  publish: (event: KiriEvent) => sink.push(event),
  subscribe: () => () => {},
});

const textParts = (parts: unknown): { type: string; text?: string }[] =>
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

// A model whose stream emits a little then stays open: only an abort ends it,
// so a turn against it parks until cancelled — making cancellation deterministic.
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

  it("persists the user and assistant messages, usage, and totals on a completed turn", async () => {
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
    expect(rows[1]?.usage).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("idle");
    expect(settled?.inputTokens).toBe(7);
    expect(settled?.outputTokens).toBe(2);
    expect(settled?.totalTokens).toBe(9);

    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "running" });
    expect(events).toContainEqual({ type: "session.updated", id: "s1", status: "idle" });
    expect(events.filter((e) => e.type === "session.message.added")).toHaveLength(2);
  });

  it("rejects before persisting anything when the model cannot be resolved", async () => {
    const llmClients: LlmClients = {
      resolveModel: () => {
        throw new Error('unknown llm provider "anthropic"');
      },
      generateText: async () => ({ text: "", usage: {} }),
      listModels: async () => ({ models: [], failures: [] }),
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
    cancelRegistry.requestCancel("s1");
    await response.text();
    await done;

    const settled = getSession(db, "s1");
    expect(settled?.status).toBe("cancelled");
    expect(settled?.finishedAt).toBeInstanceOf(Date);
    expect(getSessionMessages(db, "s1").map((r) => r.role)).toEqual(["user"]);
    expect(events).toContainEqual({ type: "session.finished", id: "s1", status: "cancelled" });
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

    // Usage aggregates across both steps of the loop.
    expect(rows[1]?.usage).toEqual({ inputTokens: 8, outputTokens: 5, totalTokens: 13 });
    expect(getSession(db, "s1")?.status).toBe("idle");
    expect(getSession(db, "s1")?.totalTokens).toBe(13);
  });

  it("pauses for tool approval instead of running the tool, settling idle", async () => {
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
    // The session is back to idle, awaiting the user's decision.
    expect(getSession(db, "s1")?.status).toBe("idle");
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
    // Usage accrues across the pause: step 1 (5/1) plus step 2 (3/4).
    expect(rows[1]?.usage).toEqual({ inputTokens: 8, outputTokens: 5, totalTokens: 13 });
    expect(getSession(db, "s1")?.totalTokens).toBe(13);
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
