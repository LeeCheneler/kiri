import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { UIMessage } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import { createSession, getSession, getSessionMessages } from "./store.ts";
import { runTurn } from "./turn.ts";

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

const finishReason = (unified: "stop" | "error") => ({ unified, raw: unified });

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
});
