import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { z } from "zod";
import { describedModel } from "../../../tests/support/described-model.ts";
import { resumeTurn, runTurn, turnStarter } from "../../../tests/support/turn-runner.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { messageParentTool } from "./delegate-tool.ts";
import { type DelegationMessaging, createDelegationMessaging } from "./delegation-messaging.ts";
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
import { ShuttingDownError, TurnInFlightError } from "./turn-lifecycle.ts";
import type { StartTurn } from "./turn-start.ts";
import type { RunTurnDeps } from "./turn.ts";

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
  describeModel: async (id) => describedModel(id),
});

// Wake turns run detached from the call that triggered them, so assertions
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

describe("createDelegationMessaging", () => {
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
    const turnDeps: RunTurnDeps = { db, llmClients: clientsFor(capturingModel(prompts)), bus };
    const messaging: DelegationMessaging = createDelegationMessaging({
      db,
      bus,
      startTurn: turnStarter({
        db,
        bus,
        llmClients: turnDeps.llmClients,
        prepareTurn: (session) => ({ session, turnDeps }),
        onSettled: (sessionId, settlement) => messaging.turnSettled(sessionId, settlement),
      }),
    });
    messaging.recover();
    return { bus, messaging };
  };

  it("queues and announces a message, waking the idle session it is for", async () => {
    const prompts: unknown[] = [];
    const { bus, messaging } = mount(prompts);
    const events: KiriEvent[] = [];
    bus.subscribe((event) => events.push(event));
    createSession(db, MODEL, { id: "parent" });

    messaging.send("parent", { source: "child", text: "the report" });

    await until(() => getSessionMessages(db, "parent").length === 2);
    await until(() => getSession(db, "parent")?.status === "idle");
    expect(JSON.stringify(prompts[0])).toContain("the report");
    expect(pendingInboxItems(db, "parent")).toEqual([]);
    expect(events[0]).toEqual({
      type: "session.inbox.queued",
      sessionId: "parent",
      source: "child",
    });
  });

  it("restarts a cancelled session for the user's own message, ahead of which its held backlog drains", async () => {
    const prompts: unknown[] = [];
    const { messaging } = mount(prompts);
    createSession(db, MODEL, { id: "stopped" });
    setSessionStatus(db, "stopped", "cancelled");
    messaging.send("stopped", { source: "child", text: "held report" });
    await tick();
    expect(getSession(db, "stopped")?.status).toBe("cancelled");

    messaging.send("stopped", { source: "user", text: "carry on" });

    await until(() => getSession(db, "stopped")?.status === "idle");
    const prompt = JSON.stringify(prompts[0]);
    expect(prompt.indexOf("held report")).toBeLessThan(prompt.indexOf("carry on"));
    expect(pendingInboxItems(db, "stopped")).toEqual([]);
  });

  it("wakes an idle session found holding a backlog when it mounts", async () => {
    createSession(db, MODEL, { id: "stranded" });
    enqueueInboxItem(db, "stranded", { source: "user", text: "queued before the stop" });
    const prompts: unknown[] = [];

    mount(prompts);

    await until(() => getSession(db, "stranded")?.status === "idle" && prompts.length === 1);
    expect(JSON.stringify(prompts[0])).toContain("queued before the stop");
    expect(pendingInboxItems(db, "stranded")).toEqual([]);
  });

  it("leaves sessions the user must act on untouched when it mounts", async () => {
    for (const [id, status] of [
      ["interrupted", "failed"],
      ["paused", "waiting"],
      ["stopped", "cancelled"],
    ] as const) {
      createSession(db, MODEL, { id });
      setSessionStatus(db, id, status);
      enqueueInboxItem(db, id, { source: "user", text: "held" });
    }
    const prompts: unknown[] = [];

    mount(prompts);
    await tick();

    expect(prompts).toEqual([]);
    for (const id of ["interrupted", "paused", "stopped"]) {
      expect(pendingInboxItems(db, id)).toHaveLength(1);
    }
  });

  it("runs the wake turn with the session and dependencies its preparation returns", async () => {
    const bus = createEventBus();
    const prompted: (string | null)[] = [];
    const messaging = createDelegationMessaging({
      db,
      bus,
      // A preparation that repairs the working directory before the turn.
      startTurn: turnStarter({
        db,
        bus,
        llmClients: clientsFor(capturingModel([])),
        prepareTurn: (session) => ({
          session: updateSessionCwd(db, session.id, dir),
          turnDeps: {
            db,
            bus,
            llmClients: clientsFor(capturingModel([])),
            buildSystemPrompt: (current) => {
              prompted.push(current.cwd);
              return "prompt";
            },
          },
        }),
      }),
    });
    createSession(db, MODEL, { id: "parent", cwd: join(dir, "gone") });

    messaging.send("parent", { source: "child", text: "the report" });

    await until(() => getSession(db, "parent")?.status === "idle" && prompted.length > 0);
    expect(prompted[0]).toBe(dir);
  });

  it("leaves a session with nothing queued unprepared", async () => {
    const bus = createEventBus();
    let prepared = 0;
    const messaging = createDelegationMessaging({
      db,
      bus,
      startTurn: turnStarter({
        db,
        bus,
        llmClients: clientsFor(capturingModel([])),
        prepareTurn: (session) => {
          prepared += 1;
          return { session, turnDeps: { db, bus, llmClients: clientsFor(capturingModel([])) } };
        },
      }),
    });
    createSession(db, MODEL, { id: "parent" });

    // The turn settles with nothing left over: what was queued wove in.
    messaging.turnSettled("parent", { status: "idle", messageId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(prepared).toBe(0);
    expect(getSession(db, "parent")?.status).toBe("idle");
  });

  it("wakes a failed session, so a dead parent still hears its workers", async () => {
    const { messaging } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "failed", {
      error: { message: "provider down" },
      finishedAt: new Date(),
    });

    messaging.send("parent", { source: "child", text: "done" });

    await until(() => getSession(db, "parent")?.status === "idle");
    expect(getSession(db, "parent")?.error).toBeNull();
  });

  it("wakes on settling idle with a backlog — a message that missed the last step boundary", async () => {
    const prompts: unknown[] = [];
    const { messaging } = mount(prompts);
    createSession(db, MODEL, { id: "parent" });
    // The message arrived while the parent was mid-turn (so the send found
    // it unwakeable) but after its last step boundary (so it never
    // wove in). The settle is the only signal left.
    setSessionStatus(db, "parent", "running");
    messaging.send("parent", { source: "child", text: "late report" });
    await tick();
    expect(getSessionMessages(db, "parent")).toEqual([]);

    setSessionStatus(db, "parent", "idle");
    messaging.turnSettled("parent", { status: "idle", messageId: null });

    await until(() => getSessionMessages(db, "parent").length === 2);
    expect(JSON.stringify(prompts[0])).toContain("late report");
    expect(pendingInboxItems(db, "parent")).toEqual([]);
  });

  it("never wakes a busy, approval-paused, or cancelled session", async () => {
    const { messaging } = mount();
    for (const [id, status] of [
      ["busy", "running"],
      ["paused", "waiting"],
      ["stopped", "cancelled"],
    ] as const) {
      createSession(db, MODEL, { id });
      setSessionStatus(db, id, status);
      messaging.send(id, { source: "parent", text: "steer" });
    }
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

  it("treats losing the session to another turn as no failure", async () => {
    const bus = createEventBus();
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const messaging = createDelegationMessaging({
      db,
      bus,
      startTurn: (async (session: Session) => {
        throw new TurnInFlightError(session.id);
      }) as StartTurn,
    });
    createSession(db, MODEL, { id: "parent" });

    messaging.send("parent", { source: "child", text: "report" });
    await tick();

    // The turn that holds the session delivers the backlog; nothing went wrong here.
    expect(logged).not.toHaveBeenCalled();
    expect(getSession(db, "parent")?.status).toBe("idle");
    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
    logged.mockRestore();
  });

  it("leaves the backlog queued when the application is shutting down", async () => {
    const bus = createEventBus();
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const messaging = createDelegationMessaging({
      db,
      bus,
      startTurn: (async () => {
        throw new ShuttingDownError();
      }) as StartTurn,
    });
    createSession(db, MODEL, { id: "parent" });

    messaging.send("parent", { source: "child", text: "report" });
    await tick();

    // The next start wakes the session for it; nothing went wrong here.
    expect(logged).not.toHaveBeenCalled();
    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
    logged.mockRestore();
  });

  it("survives a wake whose turn cannot start, leaving the backlog queued", async () => {
    const bus = createEventBus();
    const turnDeps: RunTurnDeps = {
      db,
      llmClients: {
        ...clientsFor(capturingModel([])),
        resolveModel: () => {
          throw new Error("bad model id");
        },
      },
      bus,
    };
    const messaging = createDelegationMessaging({
      db,
      bus,
      startTurn: turnStarter({
        db,
        bus,
        llmClients: turnDeps.llmClients,
        prepareTurn: (session) => ({ session, turnDeps }),
      }),
    });
    createSession(db, MODEL, { id: "parent" });

    messaging.send("parent", { source: "child", text: "report" });
    await tick();

    // The failed resolve did not drain the backlog or start a model call.
    expect(getSession(db, "parent")?.status).toBe("failed");
    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
  });

  it("notices the parent, by the worker's name, when a child's turn fails", async () => {
    const prompts: unknown[] = [];
    const { messaging } = mount(prompts);
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

    messaging.turnSettled("worker", { status: "failed", messageId: null });

    // The notice is sent to the parent like any message, which wakes it.
    await until(() => getSessionMessages(db, "parent").length === 2);
    const notice = JSON.stringify(getSessionMessages(db, "parent")[0]?.parts);
    expect(notice).toContain("turn failed");
    expect(notice).toContain("rate limited");
    expect(notice).toContain('"fromSessionId":"worker"');
    // The wake turn's framing names the worker by resolving its live title.
    expect(JSON.stringify(prompts[0])).toContain('Your delegated worker \\"CVE scan\\"');
  });

  it("sends no notice when a top-level or deleted session settles", async () => {
    const { messaging } = mount();
    createSession(db, MODEL, { id: "solo" });
    setSessionStatus(db, "solo", "failed", { error: { message: "boom" } });
    createSession(db, MODEL, {
      id: "worker",
      parentSessionId: "solo",
      parentToolCallId: "call-1",
    });

    messaging.turnSettled("solo", { status: "failed", messageId: null });
    messaging.turnSettled("gone", { status: "idle", messageId: null });
    await tick();

    expect(pendingInboxItems(db, "solo")).toEqual([]);
    expect(getSessionMessages(db, "solo")).toEqual([]);
  });

  it("wakes a parent with the saved reply when its worker ends without message_parent", async () => {
    const prompts: unknown[] = [];
    const { bus, messaging } = mount(prompts);
    const events: KiriEvent[] = [];
    bus.subscribe((event) => events.push(event));
    createSession(db, MODEL, { id: "parent" });
    const worker = createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    await (
      await runTurn(
        { db, bus, llmClients: clientsFor(capturingModel([])), onSettled: messaging.turnSettled },
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
  });

  it.each(["running", "waiting", "cancelled"] as const)(
    "queues a worker's settlement without waking a %s parent",
    async (status) => {
      const { messaging } = mount();
      createSession(db, MODEL, { id: "parent" });
      setSessionStatus(db, "parent", status);
      createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
      messaging.turnSettled("worker", { status: "cancelled", messageId: null });
      await tick();
      expect(getSession(db, "parent")?.status).toBe(status);
      expect(getSessionMessages(db, "parent")).toEqual([]);
      const notice = pendingInboxItems(db, "parent")[0]?.text;
      expect(notice).toContain("cancelled by the user");
      expect(notice).toContain("will not restart on its own");
    },
  );

  it("bounds fallback replies, identifies exhaustion, and links the saved transcript", () => {
    const { messaging } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    const message = appendMessage(db, "worker", {
      role: "assistant",
      parts: [{ type: "text", text: `Findings: ${"long report ".repeat(1500)}` }],
    });
    messaging.turnSettled("worker", { status: "failed", incomplete: true, messageId: message.id });
    const notice = pendingInboxItems(db, "parent")[0]?.text ?? "";
    expect(notice.length).toBeLessThanOrEqual(8_000);
    expect(notice).toContain("work or context limit");
    expect(notice).toContain("Findings:");
    expect(notice).toContain(`/sessions/worker (message ${message.id})`);
    expect(notice).toContain("Excerpt truncated");
  });

  it("does not mistake an older reply for output from a failed turn with no saved message", () => {
    const { messaging } = mount();
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    appendMessage(db, "worker", {
      role: "assistant",
      parts: [{ type: "text", text: "OLD RESULT" }],
    });
    messaging.turnSettled("worker", { status: "failed", messageId: null });
    const notice = pendingInboxItems(db, "parent")[0]?.text;
    expect(notice).toContain("No final reply was saved");
    expect(notice).not.toContain("OLD RESULT");
  });

  it.each(["progress", "progress only", "result", "failed delivery"] as const)(
    "sends settlement after %s without losing or duplicating the saved final reply",
    async (kind) => {
      const { bus, messaging } = mount();
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
          : messageParentTool({ db, childSessionId: "worker", sendMessage: messaging.send });
      await (
        await runTurn(
          { db, bus, llmClients: clientsFor(model), tools, onSettled: messaging.turnSettled },
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
    const messaging: DelegationMessaging = createDelegationMessaging({
      db,
      bus,
      startTurn: turnStarter({
        db,
        bus,
        llmClients: {
          ...clientsFor(capturingModel([])),
          resolveModel: () => {
            throw "model removed";
          },
        },
        prepareTurn: () => {
          throw new Error("a session whose model does not resolve is not prepared");
        },
        onSettled: (sessionId, settlement) => messaging.turnSettled(sessionId, settlement),
      }),
    });
    createSession(db, MODEL, { id: "parent" });
    setSessionStatus(db, "parent", "waiting");
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    messaging.send("worker", { source: "parent", text: "Follow up" });
    await until(() => getSession(db, "worker")?.status === "failed");
    expect(pendingInboxItems(db, "parent")[0]?.text).toContain("model removed");
    expect(pendingInboxItems(db, "worker")).toHaveLength(1);
  });

  it("waits for approval resolution before notifying the parent that the worker ended", async () => {
    const prompts: unknown[] = [];
    const { bus, messaging } = mount(prompts);
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
      onSettled: messaging.turnSettled,
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

  it("takes nothing from the bus: an announced message or settle starts no turn", async () => {
    const { bus } = mount();
    createSession(db, MODEL, { id: "parent" });
    createSession(db, MODEL, { id: "worker", parentSessionId: "parent" });
    enqueueInboxItem(db, "parent", { source: "user", text: "queued elsewhere" });

    bus.publish({ type: "session.inbox.queued", sessionId: "parent", source: "user" });
    bus.publish({ type: "session.updated", id: "parent", status: "idle" });
    bus.publish({ type: "session.turn.settled", id: "worker", messageId: null, outcome: "ended" });
    await tick();

    expect(pendingInboxItems(db, "parent")).toHaveLength(1);
    expect(getSessionMessages(db, "parent")).toEqual([]);
  });
});
