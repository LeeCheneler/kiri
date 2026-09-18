import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { UIMessage } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { describedModel } from "../../../tests/support/described-model.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { enqueueInboxItem, pendingInboxItems } from "./inbox.ts";
import {
  type Session,
  appendMessage,
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
  updateSessionCwd,
} from "./store.ts";
import { type StreamRegistry, createStreamRegistry } from "./stream-registry.ts";
import { TurnInFlightError, type TurnLifecycle, createTurnLifecycle } from "./turn-lifecycle.ts";
import { createTurnStarter } from "./turn-start.ts";

const MODEL = "test:model";

const USER_MESSAGE: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Hi there" }],
};

const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

// Answers "ok" and finishes.
const replyingModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    }),
  }) as unknown as LlmModel;

// Stays open until the turn's signal aborts, then errors like an aborted fetch.
const parkedModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          abortSignal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        },
      }),
    }),
  }) as unknown as LlmModel;

const clientsFor = (model: LlmModel, overrides: Partial<LlmClients> = {}): LlmClients => ({
  resolveModel: () => model,
  resolveImageModel: () => {
    throw new Error("no image model in this fake");
  },
  resolveTranscriptionModel: () => {
    throw new Error("no transcription model in this fake");
  },
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
  describeModel: async (id) => describedModel(id),
  ...overrides,
});

describe("createTurnStarter", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let events: KiriEvent[];
  let streamRegistry: StreamRegistry;
  let lifecycle: TurnLifecycle;
  let prepared: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-turn-start-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
    streamRegistry = createStreamRegistry();
    lifecycle = createTurnLifecycle({ db, bus, streamRegistry });
    prepared = [];
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // A starter whose preparation repairs the working directory, the write a
  // refused start must not make.
  const starter = (llmClients: LlmClients) =>
    createTurnStarter({
      db,
      llmClients,
      lifecycle,
      prepareTurn: (session: Session) => {
        prepared.push(session.id);
        return {
          session: updateSessionCwd(db, session.id, dir),
          turnDeps: { db, bus, llmClients },
        };
      },
    });

  const settledEvents = () => events.filter((event) => event.type === "session.turn.settled");

  it("refuses a second start while a turn holds the session, writing nothing", async () => {
    const startTurn = starter(clientsFor(parkedModel()));
    const session = createSession(db, MODEL, { id: "s1" });
    const first = await startTurn(session, { kind: "message", userMessage: USER_MESSAGE });
    prepared.length = 0;

    await expect(
      startTurn(session, { kind: "message", userMessage: { ...USER_MESSAGE, id: "u2" } }),
    ).rejects.toBeInstanceOf(TurnInFlightError);

    expect(prepared).toEqual([]);
    expect(getSessionMessages(db, "s1").map((message) => message.id)).toEqual(["u1"]);
    expect(getSession(db, "s1")?.status).toBe("running");
    // The refusal left the first turn's hold intact: it is still the one a cancel reaches.
    expect(lifecycle.cancel("s1")).toBe(true);
    await first.done;
    expect(getSession(db, "s1")?.status).toBe("cancelled");
  });

  it("rejects a message whose model does not resolve before preparing the session", async () => {
    const startTurn = starter(
      clientsFor(replyingModel(), {
        resolveModel: () => {
          throw new Error("unknown provider");
        },
      }),
    );
    const session = createSession(db, MODEL, { id: "s1" });

    await expect(
      startTurn(session, { kind: "message", userMessage: USER_MESSAGE }),
    ).rejects.toThrow("unknown provider");

    expect(prepared).toEqual([]);
    expect(getSession(db, "s1")).toMatchObject({ status: "idle", cwd: null, error: null });
    expect(getSessionMessages(db, "s1")).toEqual([]);
    expect(events).toEqual([]);
    // The session was given back: the next start is not refused as concurrent.
    await expect(
      startTurn(session, { kind: "message", userMessage: USER_MESSAGE }),
    ).rejects.toThrow("unknown provider");
  });

  it("rejects verdicts that match no pending call before preparing the session", async () => {
    const startTurn = starter(clientsFor(replyingModel()));
    const session = createSession(db, MODEL, { id: "s1" });
    appendMessage(db, "s1", { role: "assistant", parts: [{ type: "text", text: "done" }] });
    setSessionStatus(db, "s1", "waiting");

    await expect(
      startTurn(session, { kind: "approvals", approvals: [{ toolCallId: "c9", approved: true }] }),
    ).rejects.toThrow("no pending tool approval matching");

    expect(prepared).toEqual([]);
    expect(getSession(db, "s1")).toMatchObject({ status: "waiting", cwd: null });
  });

  it("fails a turn that cannot carry on after the session was marked running", async () => {
    const startTurn = starter(
      clientsFor(replyingModel(), {
        describeModel: async () => {
          throw new Error("discovery exploded");
        },
      }),
    );
    const session = createSession(db, MODEL, { id: "s1" });

    await expect(
      startTurn(session, { kind: "message", userMessage: USER_MESSAGE }),
    ).rejects.toThrow("discovery exploded");

    expect(getSession(db, "s1")).toMatchObject({
      status: "failed",
      error: { message: "discovery exploded" },
    });
    expect(settledEvents()).toEqual([
      { type: "session.turn.settled", id: "s1", messageId: null, outcome: "failed" },
    ]);
    expect(events.at(-1)).toEqual({ type: "session.finished", id: "s1", status: "failed" });
    expect(streamRegistry.has("s1")).toBe(false);
    expect(lifecycle.cancel("s1")).toBe(false);
  });

  it("recovers on the next message after a start failed", async () => {
    let discoveries = 0;
    const startTurn = starter(
      clientsFor(replyingModel(), {
        describeModel: async (id) => {
          discoveries += 1;
          if (discoveries === 1) throw new Error("discovery exploded");
          return describedModel(id);
        },
      }),
    );
    const session = createSession(db, MODEL, { id: "s1" });
    await expect(
      startTurn(session, { kind: "message", userMessage: USER_MESSAGE }),
    ).rejects.toThrow();

    const retry = await startTurn(session, {
      kind: "message",
      userMessage: { ...USER_MESSAGE, id: "u2" },
    });
    await retry.done;

    expect(getSession(db, "s1")).toMatchObject({ status: "idle", error: null });
  });

  it("settles a wake that cannot start as failed, leaving its backlog queued", async () => {
    const startTurn = starter(
      clientsFor(replyingModel(), {
        resolveModel: () => {
          throw new Error("model removed");
        },
      }),
    );
    const session = createSession(db, MODEL, { id: "s1" });
    enqueueInboxItem(db, "s1", { source: "parent", text: "follow up" });

    await expect(startTurn(session, { kind: "wake" })).rejects.toThrow("model removed");

    expect(prepared).toEqual([]);
    expect(getSession(db, "s1")).toMatchObject({
      status: "failed",
      error: { message: "model removed" },
    });
    expect(settledEvents()).toEqual([
      { type: "session.turn.settled", id: "s1", messageId: null, outcome: "failed" },
    ]);
    expect(pendingInboxItems(db, "s1")).toHaveLength(1);
    expect(lifecycle.cancel("s1")).toBe(false);
  });

  it("leaves a wake with nothing queued alone", async () => {
    const startTurn = starter(clientsFor(replyingModel()));
    const session = createSession(db, MODEL, { id: "s1" });

    expect(await startTurn(session, { kind: "wake" })).toBeNull();

    expect(prepared).toEqual([]);
    expect(events).toEqual([]);
    expect(lifecycle.cancel("s1")).toBe(false);
  });
});
