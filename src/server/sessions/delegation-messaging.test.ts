import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { mountDelegationMessaging } from "./delegation-messaging.ts";
import { enqueueInboxItem, pendingInboxItems } from "./inbox.ts";
import { createSession, getSession, getSessionMessages, setSessionStatus } from "./store.ts";
import type { RunTurnDeps } from "./turn.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// A model that answers "ok", capturing each prompt it is handed.
const capturingModel = (prompts: unknown[]): LlmModel =>
  new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      return {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: {
              inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ]),
      };
    },
  }) as unknown as LlmModel;

const clientsFor = (model: LlmModel): LlmClients => ({
  resolveModel: () => model,
  resolveImageModel: () => {
    throw new Error("no image model in this fake");
  },
  resolveTranscriptionModel: () => {
    throw new Error("no transcription model in this fake");
  },
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
  contextWindowFor: async () => undefined,
  reasoningOptionsFor: async () => undefined,
});

// Wake turns run detached from the event that triggered them, so assertions
// poll for the settled state rather than awaiting a handle.
const until = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not met in time");
};

// A settled tick for asserting that nothing happened.
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("mountDelegationMessaging", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-delegation-msg-"));
    db = openDatabase(join(dir, "kiri.db"));
    migrate(db);
  });
  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const mount = (prompts: unknown[] = []) => {
    const bus = createEventBus();
    const turnDepsFor = (): RunTurnDeps => ({
      db,
      llmClients: clientsFor(capturingModel(prompts)),
      bus,
    });
    const unsubscribe = mountDelegationMessaging({ db, bus, turnDepsFor });
    return { bus, unsubscribe };
  };

  it("wakes an idle session when a message queues for it", async () => {
    const prompts: unknown[] = [];
    const { bus } = mount(prompts);
    createSession(db, MODEL, { id: "parent" });
    enqueueInboxItem(db, "parent", { source: "child", text: "the report" });

    bus.publish({ type: "session.inbox.queued", sessionId: "parent" });

    await until(() => getSessionMessages(db, "parent").length === 2);
    await until(() => getSession(db, "parent")?.status === "idle");
    expect(JSON.stringify(prompts[0])).toContain("the report");
    expect(pendingInboxItems(db, "parent")).toEqual([]);
  });

  it("wakes a failed session, so a dead parent still hears its workers", async () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "failed", {
      error: { message: "provider down" },
      finishedAt: new Date(),
    });
    enqueueInboxItem(db, "parent", { source: "child", text: "done" });

    bus.publish({ type: "session.inbox.queued", sessionId: "parent" });

    await until(() => getSession(db, "parent")?.status === "idle");
    expect(getSession(db, "parent")?.error).toBeNull();
  });

  it("wakes on settling idle with a backlog — a message that missed the last step boundary", async () => {
    const prompts: unknown[] = [];
    const { bus } = mount(prompts);
    createSession(db, MODEL, { id: "parent" });
    // The message arrived while the parent was mid-turn (so the queued event
    // found it unwakeable) but after its last step boundary (so it never
    // wove in). The settle is the only signal left.
    setSessionStatus(db, "parent", "running");
    enqueueInboxItem(db, "parent", { source: "child", text: "late report" });
    bus.publish({ type: "session.inbox.queued", sessionId: "parent" });
    await tick();
    expect(getSessionMessages(db, "parent")).toEqual([]);

    setSessionStatus(db, "parent", "idle");
    bus.publish({ type: "session.updated", id: "parent", status: "idle" });

    await until(() => getSessionMessages(db, "parent").length === 2);
    expect(JSON.stringify(prompts[0])).toContain("late report");
    expect(pendingInboxItems(db, "parent")).toEqual([]);
  });

  it("never wakes a busy, approval-paused, or cancelled session — or one that is gone", async () => {
    const { bus } = mount();
    for (const [id, status] of [
      ["busy", "running"],
      ["paused", "waiting"],
      ["stopped", "cancelled"],
    ] as const) {
      createSession(db, MODEL, { id });
      setSessionStatus(db, id, status);
      enqueueInboxItem(db, id, { source: "parent", text: "steer" });
      bus.publish({ type: "session.inbox.queued", sessionId: id });
    }
    bus.publish({ type: "session.inbox.queued", sessionId: "no-such-session" });
    await tick();

    for (const [id, status] of [
      ["busy", "running"],
      ["paused", "waiting"],
      ["stopped", "cancelled"],
    ] as const) {
      expect(getSession(db, id)?.status).toBe(status);
      expect(getSessionMessages(db, id)).toEqual([]);
      expect(pendingInboxItems(db, id)).toHaveLength(1);
    }
  });

  it("survives a wake whose turn cannot start, leaving the backlog queued", async () => {
    const bus = createEventBus();
    const turnDepsFor = (): RunTurnDeps => ({
      db,
      llmClients: {
        ...clientsFor(capturingModel([])),
        resolveModel: () => {
          throw new Error("bad model id");
        },
      },
      bus,
    });
    mountDelegationMessaging({ db, bus, turnDepsFor });
    createSession(db, MODEL, { id: "parent" });
    enqueueInboxItem(db, "parent", { source: "child", text: "report" });

    bus.publish({ type: "session.inbox.queued", sessionId: "parent" });
    await tick();

    // The failed resolve happened before any write: nothing drained, nothing ran.
    expect(getSession(db, "parent")?.status).toBe("idle");
    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
  });

  it("notices the parent, by the worker's name, when a child's turn fails", async () => {
    const prompts: unknown[] = [];
    const { bus } = mount(prompts);
    createSession(db, MODEL, { id: "parent" });
    createSession(db, MODEL, {
      id: "worker",
      title: "CVE scan",
      parentSessionId: "parent",
      parentToolCallId: "call-1",
    });
    setSessionStatus(db, "worker", "failed", {
      error: { message: "rate limited" },
      finishedAt: new Date(),
    });

    bus.publish({ type: "session.finished", id: "worker", status: "failed" });

    // The notice queues for the parent and the queued event wakes it — the
    // same loop, end to end.
    await until(() => getSessionMessages(db, "parent").length === 2);
    const notice = JSON.stringify(getSessionMessages(db, "parent")[0]?.parts);
    expect(notice).toContain("turn failed");
    expect(notice).toContain("rate limited");
    expect(notice).toContain('"fromSessionId":"worker"');
    // The wake turn's framing names the worker by resolving its live title.
    expect(JSON.stringify(prompts[0])).toContain('Your delegated worker \\"CVE scan\\"');
  });

  it("ignores failures of sessions with no parent, and of settled statuses", async () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "solo" });
    setSessionStatus(db, "solo", "failed", { error: { message: "boom" } });
    createSession(db, MODEL, {
      id: "worker",
      parentSessionId: "solo",
      parentToolCallId: "call-1",
    });

    bus.publish({ type: "session.finished", id: "solo", status: "failed" });
    bus.publish({ type: "session.finished", id: "worker", status: "cancelled" });
    bus.publish({ type: "session.finished", id: "gone", status: "failed" });
    await tick();

    expect(pendingInboxItems(db, "solo")).toEqual([]);
    expect(getSessionMessages(db, "solo")).toEqual([]);
  });

  it("stops reacting once unmounted", async () => {
    const { bus, unsubscribe } = mount();
    createSession(db, MODEL, { id: "parent" });
    enqueueInboxItem(db, "parent", { source: "child", text: "report" });

    unsubscribe();
    bus.publish({ type: "session.inbox.queued", sessionId: "parent" });
    await tick();

    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
    expect(getSessionMessages(db, "parent")).toEqual([]);
  });
});
