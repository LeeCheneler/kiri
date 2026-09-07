import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import { messageParentTool } from "./delegate-tool.ts";
import { mountDelegationMessaging } from "./delegation-messaging.ts";
import { enqueueInboxItem, pendingInboxItems } from "./inbox.ts";
import {
  appendMessage,
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
} from "./store.ts";
import { type RunTurnDeps, resumeTurn, runTurn } from "./turn.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// A model that answers "ok", capturing each prompt it is handed.
const capturingModel = (prompts: unknown[]): LlmModel =>
  new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt);
      return {
        stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
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

    // The failed resolve did not drain the backlog or start a model call.
    expect(getSession(db, "parent")?.status).toBe("failed");
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

    bus.publish({ type: "session.turn.settled", id: "worker", messageId: null, outcome: "failed" });

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

  it("ignores settlement of top-level or deleted sessions and unrelated lifecycle events", async () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "solo" });
    setSessionStatus(db, "solo", "failed", { error: { message: "boom" } });
    createSession(db, MODEL, {
      id: "worker",
      parentSessionId: "solo",
      parentToolCallId: "call-1",
    });

    bus.publish({ type: "session.turn.settled", id: "solo", messageId: null, outcome: "failed" });
    bus.publish({ type: "session.finished", id: "worker", status: "cancelled" });
    bus.publish({ type: "session.turn.settled", id: "gone", messageId: null, outcome: "ended" });
    await tick();

    expect(pendingInboxItems(db, "solo")).toEqual([]);
    expect(getSessionMessages(db, "solo")).toEqual([]);
  });

  it("wakes a parent with the saved reply when its worker ends without message_parent", async () => {
    const prompts: unknown[] = [];
    const { bus } = mount(prompts);
    const events: KiriEvent[] = [];
    bus.subscribe((event) => events.push(event));
    createSession(db, MODEL, { id: "parent" });
    const worker = createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    await (
      await runTurn(
        { db, bus, llmClients: clientsFor(capturingModel([])) },
        {
          session: worker,
          userMessage: { id: "brief", role: "user", parts: [{ type: "text", text: "Check it" }] },
        },
      )
    ).done;
    await until(
      () =>
        getSessionMessages(db, "parent").length === 2 &&
        getSession(db, "parent")?.status === "idle",
    );
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts[0])).toContain("worker's turn ended");
    expect(JSON.stringify(prompts[0])).toContain("Saved worker reply (may be partial):\\nok");
    expect(JSON.stringify(prompts[0])).toContain("does not establish task completion");
    expect(
      events.filter((event) => event.type === "session.turn.settled" && event.id === "worker"),
    ).toHaveLength(1);
    // The legacy lifecycle signal must not enqueue a second notice.
    bus.publish({ type: "session.finished", id: "worker", status: "failed" });
    await tick();
    expect(prompts).toHaveLength(1);
  });

  it.each(["running", "waiting", "cancelled"] as const)(
    "queues a worker's settlement without waking a %s parent",
    async (status) => {
      const { bus } = mount();
      createSession(db, MODEL, { id: "parent" });
      setSessionStatus(db, "parent", status);
      createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
      bus.publish({
        type: "session.turn.settled",
        id: "worker",
        messageId: null,
        outcome: "cancelled",
      });
      await tick();
      expect(getSession(db, "parent")?.status).toBe(status);
      expect(getSessionMessages(db, "parent")).toEqual([]);
      const notice = pendingInboxItems(db, "parent")[0]?.text;
      expect(notice).toContain("cancelled by the user");
      expect(notice).toContain("will not restart on its own");
    },
  );

  it("bounds fallback replies, identifies exhaustion, and links the saved transcript", () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    const message = appendMessage(db, "worker", {
      role: "assistant",
      parts: [{ type: "text", text: `Findings: ${"long report ".repeat(1500)}` }],
    });
    bus.publish({
      type: "session.turn.settled",
      id: "worker",
      messageId: message.id,
      outcome: "incomplete",
    });
    const notice = pendingInboxItems(db, "parent")[0]?.text ?? "";
    expect(notice.length).toBeLessThanOrEqual(8_000);
    expect(notice).toContain("work step limit");
    expect(notice).toContain("Findings:");
    expect(notice).toContain(`/sessions/worker (message ${message.id})`);
    expect(notice).toContain("Excerpt truncated");
  });

  it("does not mistake an older reply for output from a failed turn with no saved message", () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    appendMessage(db, "worker", {
      role: "assistant",
      parts: [{ type: "text", text: "OLD RESULT" }],
    });
    bus.publish({ type: "session.turn.settled", id: "worker", messageId: null, outcome: "failed" });
    const notice = pendingInboxItems(db, "parent")[0]?.text;
    expect(notice).toContain("No final reply was saved");
    expect(notice).not.toContain("OLD RESULT");
  });

  it.each(["progress", "progress only", "result", "failed delivery"] as const)(
    "sends settlement after %s without losing or duplicating the saved final reply",
    async (kind) => {
      const { bus } = mount();
      createSession(db, MODEL, { id: "parent" });
      setSessionStatus(db, "parent", "waiting");
      const worker = createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
      const report = "The final finding is 42.";
      let calls = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => {
          calls += 1;
          return {
            stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(
              calls === 1
                ? [
                    {
                      type: "tool-call",
                      toolCallId: "report",
                      toolName: "message_parent",
                      input: JSON.stringify({
                        message: kind.startsWith("progress") ? "Still checking." : report,
                      }),
                    },
                    {
                      type: "finish",
                      finishReason: { unified: "tool-calls", raw: "tool_calls" },
                      usage: {
                        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
                        outputTokens: { total: 1, text: 1, reasoning: 0 },
                      },
                    },
                  ]
                : [
                    { type: "text-start", id: "reply" },
                    {
                      type: "text-delta",
                      id: "reply",
                      delta: kind === "progress only" ? "" : report,
                    },
                    { type: "text-end", id: "reply" },
                    {
                      type: "finish",
                      finishReason: { unified: "stop", raw: "stop" },
                      usage: {
                        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
                        outputTokens: { total: 1, text: 1, reasoning: 0 },
                      },
                    },
                  ],
            ),
          };
        },
      }) as unknown as LlmModel;
      const tools =
        kind === "failed delivery"
          ? {
              message_parent: tool({
                inputSchema: z.object({ message: z.string() }),
                execute: (_input: { message: string }): string => {
                  throw new Error("delivery failed");
                },
              }),
            }
          : messageParentTool({ db, bus, childSessionId: "worker" });
      await (
        await runTurn(
          { db, bus, llmClients: clientsFor(model), tools },
          {
            session: worker,
            userMessage: {
              id: "brief",
              role: "user",
              parts: [{ type: "text", text: "Find the answer" }],
            },
          },
        )
      ).done;
      const inbox = pendingInboxItems(db, "parent");
      expect(inbox).toHaveLength(kind === "failed delivery" ? 1 : 2);
      expect(
        inbox
          .map((item) => item.text)
          .join("\n")
          .split(report),
      ).toHaveLength(kind === "progress only" ? 1 : 2);
      expect(inbox.at(-1)?.text).toContain("does not establish task completion");
      if (kind === "progress only")
        expect(inbox.at(-1)?.text).toContain("No final reply was saved");
      else if (kind === "result") expect(inbox.at(-1)?.text).toContain("already delivered");
      else expect(inbox.at(-1)?.text).toContain(report);
    },
  );

  it("notifies the parent if the worker cannot start a wake turn", async () => {
    const bus = createEventBus();
    const cancelRegistry = createCancelRegistry();
    mountDelegationMessaging({
      db,
      bus,
      turnDepsFor: () => ({
        db,
        bus,
        llmClients: {
          ...clientsFor(capturingModel([])),
          resolveModel: () => {
            throw "model removed";
          },
        },
        cancelRegistry,
      }),
    });
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    enqueueInboxItem(db, "worker", { source: "parent", text: "Follow up" });
    bus.publish({ type: "session.inbox.queued", sessionId: "worker" });
    await until(() => getSession(db, "worker")?.status === "failed");
    expect(pendingInboxItems(db, "parent")[0]?.text).toContain("model removed");
    expect(pendingInboxItems(db, "worker")).toHaveLength(1);
  });

  it("waits for approval resolution before notifying the parent that the worker ended", async () => {
    const prompts: unknown[] = [];
    const { bus } = mount(prompts);
    createSession(db, MODEL, { id: "parent" });
    const worker = createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        return {
          stream: convertArrayToReadableStream<LanguageModelV3StreamPart>(
            calls === 1
              ? [
                  {
                    type: "tool-call",
                    toolCallId: "approval-call",
                    toolName: "check",
                    input: "{}",
                  },
                  {
                    type: "finish",
                    finishReason: { unified: "tool-calls", raw: "tool_calls" },
                    usage: {
                      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 1, text: 1, reasoning: 0 },
                    },
                  },
                ]
              : [
                  { type: "text-start", id: "reply" },
                  { type: "text-delta", id: "reply", delta: "Checked after approval." },
                  { type: "text-end", id: "reply" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage: {
                      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 1, text: 1, reasoning: 0 },
                    },
                  },
                ],
          ),
        };
      },
    }) as unknown as LlmModel;
    const deps = {
      db,
      bus,
      llmClients: clientsFor(model),
      tools: {
        check: tool({ inputSchema: z.object({}), needsApproval: true, execute: () => "checked" }),
      },
    };
    await (
      await runTurn(deps, {
        session: worker,
        userMessage: { id: "brief", role: "user", parts: [{ type: "text", text: "Check it" }] },
      })
    ).done;
    expect(getSession(db, "worker")?.status).toBe("waiting");
    expect(prompts).toEqual([]);
    expect(pendingInboxItems(db, "parent")).toEqual([]);

    await (
      await resumeTurn(deps, {
        session: worker,
        approvals: [{ toolCallId: "approval-call", approved: true }],
      })
    ).done;
    await until(
      () =>
        getSessionMessages(db, "parent").length === 2 &&
        getSession(db, "parent")?.status === "idle",
    );
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts[0])).toContain("Checked after approval.");
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
