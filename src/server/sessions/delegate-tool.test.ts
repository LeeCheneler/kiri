import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { projects } from "../db/schema.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import {
  DELEGATE_TOOL_NAME,
  type DelegateToolDeps,
  MAX_RUNNING_CHILDREN,
  MESSAGE_PARENT_MAX_LENGTH,
  MESSAGE_PARENT_TOOL_NAME,
  MESSAGE_WORKER_TOOL_NAME,
  delegateTool,
  messageParentTool,
} from "./delegate-tool.ts";
import { pendingInboxItems } from "./inbox.ts";
import {
  createSession,
  getSession,
  getSessionMessages,
  setSessionStatus,
  updateSessionCwd,
} from "./store.ts";
import type { RunTurnDeps } from "./turn.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

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

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finishReason = (unified: "stop" | "error") => ({ unified, raw: unified });

// A worker model that replies with `text` and settles.
const reportingModel = (text: string): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: text },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: finishReason("stop"), usage: usage(2, 1) },
      ]),
    }),
  }) as unknown as LlmModel;

// The child turn runs detached from the spawning call, so assertions poll for
// its settled state rather than awaiting a handle.
const until = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not met in time");
};

describe("delegate tool", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-delegate-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    createSession(db, MODEL, { id: "parent" });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Deps driving the child against `model`, capturing which child session id
  // the turn-deps factory was asked for.
  const depsFor = (model: LlmModel, capture: { childId?: string } = {}): DelegateToolDeps => ({
    db,
    parentSessionId: "parent",
    bus,
    childTurnDeps: (childSessionId): RunTurnDeps => {
      capture.childId = childSessionId;
      return { db, llmClients: clientsFor(model), bus };
    },
  });

  // Waits for the spawned child's detached turn to settle, so no turn is
  // still writing when the test's database closes.
  const settled = (childId: string | undefined) =>
    until(() => {
      const status = childId ? getSession(db, childId)?.status : undefined;
      return status === "idle" || status === "failed" || status === "cancelled";
    });

  const invoke = (
    deps: DelegateToolDeps,
    task: string,
    opts: {
      toolCallId?: string;
      abortSignal?: AbortSignal;
      title?: string;
      model?: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
    } = {},
  ): Promise<string> => {
    const set = delegateTool(deps);
    const delegate = set[DELEGATE_TOOL_NAME] as {
      execute: (
        input: {
          title: string;
          task: string;
          model?: string;
          effort: "low" | "medium" | "high" | "xhigh" | "max";
        },
        options: { toolCallId: string; messages: []; abortSignal?: AbortSignal },
      ) => Promise<string>;
    };
    return delegate.execute(
      {
        title: opts.title ?? "Task title",
        task,
        model: opts.model,
        effort: opts.effort ?? "medium",
      },
      { toolCallId: opts.toolCallId ?? "call_1", messages: [], abortSignal: opts.abortSignal },
    );
  };

  it("spawns a detached child session and resolves immediately with its id", async () => {
    const events: KiriEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const capture: { childId?: string } = {};

    const result = await invoke(depsFor(reportingModel("On it."), capture), "Research pelicans", {
      title: "Pelican census",
    });

    // The spawn acknowledgement names the delegation and hands back the id
    // message_worker steers by; the worker's answers arrive as messages,
    // not through this call.
    expect(result).toContain('Delegated "Pelican census"');
    expect(result).toContain(capture.childId ?? "");
    expect(result).toContain(MESSAGE_WORKER_TOOL_NAME);
    expect(result).not.toContain("On it.");
    const child = capture.childId ? getSession(db, capture.childId) : undefined;
    expect(child?.parentSessionId).toBe("parent");
    expect(child?.parentToolCallId).toBe("call_1");
    expect(child?.model).toBe(MODEL);
    expect(events).toContainEqual({ type: "session.started", id: child?.id ?? "" });

    // The turn runs on detached: the transcript fills in after the call has
    // already resolved.
    await settled(capture.childId);
    expect(getSession(db, capture.childId ?? "")?.status).toBe("idle");
    const rows = getSessionMessages(db, capture.childId ?? "");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  });

  it("ignores the spawning turn's abort — cancelling a parent turn doesn't touch its children", async () => {
    const capture: { childId?: string } = {};

    await invoke(depsFor(reportingModel("Done."), capture), "Keep going", {
      abortSignal: AbortSignal.abort(),
    });

    await settled(capture.childId);
    expect(getSession(db, capture.childId ?? "")?.status).toBe("idle");
    expect(getSessionMessages(db, capture.childId ?? "")).toHaveLength(2);
  });

  it("spawns the worker on the named role's model when delegates are configured", async () => {
    const capture: { childId?: string } = {};
    const deps: DelegateToolDeps = {
      ...depsFor(reportingModel("Done."), capture),
      delegates: { quick: "a:small", daily: "a:mid", deep: "a:big" },
    };

    await invoke(deps, "Quick lookup", { model: "quick" });

    // The role resolved to its configured model at spawn — the child stores
    // that id rather than the parent's model.
    expect(capture.childId && getSession(db, capture.childId)?.model).toBe("a:small");
    await settled(capture.childId);
  });

  it("requires the model role exactly when delegates are configured", () => {
    const withDelegates = delegateTool({
      ...depsFor(reportingModel("")),
      delegates: { quick: "a:small", daily: "a:mid", deep: "a:big" },
    })[DELEGATE_TOOL_NAME] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(
      withDelegates.inputSchema.safeParse({ title: "n", task: "t", effort: "medium" }).success,
    ).toBe(false);
    expect(
      withDelegates.inputSchema.safeParse({
        title: "n",
        task: "t",
        model: "daily",
        effort: "medium",
      }).success,
    ).toBe(true);
    expect(
      withDelegates.inputSchema.safeParse({
        title: "n",
        task: "t",
        model: "katana",
        effort: "medium",
      }).success,
    ).toBe(false);

    const withoutDelegates = delegateTool(depsFor(reportingModel("")))[DELEGATE_TOOL_NAME] as {
      inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
    };
    const bare = withoutDelegates.inputSchema.safeParse({
      title: "n",
      task: "t",
      effort: "medium",
    });
    expect(bare.success).toBe(true);
    // Unconfigured, the prop doesn't exist at all — a stray value is dropped.
    const stray = withoutDelegates.inputSchema.safeParse({
      title: "n",
      task: "t",
      model: "daily",
      effort: "low",
    });
    expect(stray.data).toEqual({ title: "n", task: "t", effort: "low" });
  });

  it("offers only the configured subset of roles", () => {
    const partial = delegateTool({
      ...depsFor(reportingModel("")),
      delegates: { daily: "a:mid" },
    })[DELEGATE_TOOL_NAME] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(
      partial.inputSchema.safeParse({ title: "n", task: "t", model: "daily", effort: "medium" })
        .success,
    ).toBe(true);
    expect(
      partial.inputSchema.safeParse({ title: "n", task: "t", model: "quick", effort: "medium" })
        .success,
    ).toBe(false);
  });

  it("treats an empty delegates config as unconfigured", () => {
    const empty = delegateTool({ ...depsFor(reportingModel("")), delegates: {} })[
      DELEGATE_TOOL_NAME
    ] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(empty.inputSchema.safeParse({ title: "n", task: "t", effort: "medium" }).success).toBe(
      true,
    );
  });

  it("requires the effort level with or without delegates configured", () => {
    const withDelegates = delegateTool({
      ...depsFor(reportingModel("")),
      delegates: { quick: "a:small", daily: "a:mid", deep: "a:big" },
    })[DELEGATE_TOOL_NAME] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(
      withDelegates.inputSchema.safeParse({ title: "n", task: "t", model: "daily" }).success,
    ).toBe(false);
    expect(
      withDelegates.inputSchema.safeParse({ title: "n", task: "t", model: "daily", effort: "max" })
        .success,
    ).toBe(true);

    const withoutDelegates = delegateTool(depsFor(reportingModel("")))[DELEGATE_TOOL_NAME] as {
      inputSchema: { safeParse: (v: unknown) => { success: boolean } };
    };
    expect(withoutDelegates.inputSchema.safeParse({ title: "n", task: "t" }).success).toBe(false);
    expect(
      withoutDelegates.inputSchema.safeParse({ title: "n", task: "t", effort: "banana" }).success,
    ).toBe(false);
    expect(
      withoutDelegates.inputSchema.safeParse({ title: "n", task: "t", effort: "high" }).success,
    ).toBe(true);
  });

  it("requires the title with or without delegates configured", () => {
    const withDelegates = delegateTool({
      ...depsFor(reportingModel("")),
      delegates: { quick: "a:small", daily: "a:mid", deep: "a:big" },
    })[DELEGATE_TOOL_NAME] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(
      withDelegates.inputSchema.safeParse({ task: "t", model: "daily", effort: "medium" }).success,
    ).toBe(false);
    expect(
      withDelegates.inputSchema.safeParse({
        title: "",
        task: "t",
        model: "daily",
        effort: "medium",
      }).success,
    ).toBe(false);

    const withoutDelegates = delegateTool(depsFor(reportingModel("")))[DELEGATE_TOOL_NAME] as {
      inputSchema: { safeParse: (v: unknown) => { success: boolean } };
    };
    expect(withoutDelegates.inputSchema.safeParse({ task: "t", effort: "medium" }).success).toBe(
      false,
    );
    expect(
      withoutDelegates.inputSchema.safeParse({ title: "", task: "t", effort: "medium" }).success,
    ).toBe(false);
  });

  it("stores the title on the child session at spawn", async () => {
    const capture: { childId?: string } = {};

    await invoke(depsFor(reportingModel("Done."), capture), "Count pelicans", {
      title: "Pelican census",
    });

    expect(capture.childId && getSession(db, capture.childId)?.title).toBe("Pelican census");
    await settled(capture.childId);
  });

  it("spawns the child working from the parent's directory", async () => {
    updateSessionCwd(db, "parent", "/srv/notes");
    const capture: { childId?: string } = {};

    await invoke(depsFor(reportingModel("Done."), capture), "Count pelicans", {});

    expect(capture.childId && getSession(db, capture.childId)?.cwd).toBe("/srv/notes");
    await settled(capture.childId);
  });

  it("spawns the child without a working directory when the parent has none", async () => {
    const capture: { childId?: string } = {};

    await invoke(depsFor(reportingModel("Done."), capture), "Count pelicans", {});

    expect(capture.childId && getSession(db, capture.childId)?.cwd).toBeNull();
    await settled(capture.childId);
  });

  it("spawns the child inside the parent's project so it reads the same corpus", async () => {
    db.insert(projects).values({ id: "p1", name: "Research", createdAt: new Date() }).run();
    createSession(db, MODEL, { id: "project-parent", projectId: "p1" });
    const capture: { childId?: string } = {};

    await invoke(
      { ...depsFor(reportingModel("Done."), capture), parentSessionId: "project-parent" },
      "Count pelicans",
      {},
    );

    expect(capture.childId && getSession(db, capture.childId)?.projectId).toBe("p1");
    await settled(capture.childId);
  });

  it("stores the stated effort on the child session", async () => {
    const capture: { childId?: string } = {};

    await invoke(depsFor(reportingModel("Done."), capture), "Deep dive", { effort: "high" });

    expect(capture.childId && getSession(db, capture.childId)?.effort).toBe("high");
    await settled(capture.childId);
  });

  it("re-attaches to the child a repeated call already created, without re-driving it", async () => {
    createSession(db, MODEL, {
      id: "existing",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });
    setSessionStatus(db, "existing", "running");

    const result = await invoke(depsFor(reportingModel("unused")), "Try again");

    // The acknowledgement points at the existing child; no duplicate spawn,
    // no second turn driven into it.
    expect(result).toContain("existing");
    const children = db.$client
      .query<{ id: string }, []>("SELECT id FROM sessions WHERE parent_tool_call_id = 'call_1'")
      .all();
    expect(children.map((c) => c.id)).toEqual(["existing"]);
    expect(getSessionMessages(db, "existing")).toEqual([]);
  });

  it("caps concurrently running workers, freeing slots as they settle", async () => {
    for (let i = 0; i < MAX_RUNNING_CHILDREN; i += 1) {
      createSession(db, MODEL, {
        id: `worker-${i}`,
        parentSessionId: "parent",
        parentToolCallId: `spawn-${i}`,
      });
      setSessionStatus(db, `worker-${i}`, "running");
    }

    expect(invoke(depsFor(reportingModel("unused")), "One too many")).rejects.toThrow("the limit");

    // A settled worker frees its slot — only live ones count.
    setSessionStatus(db, "worker-0", "idle");
    const capture: { childId?: string } = {};
    await invoke(depsFor(reportingModel("Done."), capture), "Fits now", {
      toolCallId: "call_fits",
    });
    await settled(capture.childId);
  });

  it("throws when the parent session is missing", async () => {
    const deps = { ...depsFor(reportingModel("unused")), parentSessionId: "ghost" };
    expect(invoke(deps, "Anything")).rejects.toThrow('session "ghost" not found');
  });
});

describe("message_worker tool", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-send-delegate-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    events = [];
    bus.subscribe((e) => events.push(e));
    createSession(db, MODEL, { id: "parent" });
    createSession(db, MODEL, {
      id: "worker",
      title: "CVE scan",
      parentSessionId: "parent",
      parentToolCallId: "spawn-1",
    });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const send = (sessionId: string, message: string): Promise<string> => {
    const set = delegateTool({
      db,
      parentSessionId: "parent",
      bus,
      childTurnDeps: () => ({ db, llmClients: clientsFor(reportingModel("unused")) }),
    });
    const sendTool = set[MESSAGE_WORKER_TOOL_NAME] as {
      execute: (
        input: { sessionId: string; message: string },
        options: { toolCallId: string; messages: [] },
      ) => Promise<string>;
    };
    return sendTool.execute({ sessionId, message }, { toolCallId: "call_s", messages: [] });
  };

  it("queues a parent-sourced message for the worker and announces it", async () => {
    setSessionStatus(db, "worker", "running");

    const result = await send("worker", "Also cover the dev dependencies.");

    expect(result).toContain("weaves in");
    const [item] = pendingInboxItems(db, "worker");
    expect(item?.source).toBe("parent");
    expect(item?.text).toBe("Also cover the dev dependencies.");
    // The worker has exactly one parent, so the sender needs no id.
    expect(item?.fromSessionId).toBeNull();
    expect(events).toContainEqual({ type: "session.inbox.queued", sessionId: "worker" });
  });

  it("tells the parent how the message will land, by the worker's state", async () => {
    expect(await send("worker", "status?")).toContain("starts a new turn");
    setSessionStatus(db, "worker", "waiting");
    expect(await send("worker", "status?")).toContain("paused on a tool approval");
    setSessionStatus(db, "worker", "cancelled");
    expect(await send("worker", "status?")).toContain("cancelled by the user");
  });

  it("rejects a session that is not one of this conversation's workers", async () => {
    createSession(db, MODEL, { id: "other-parent" });
    createSession(db, MODEL, {
      id: "foreign-worker",
      parentSessionId: "other-parent",
      parentToolCallId: "spawn-x",
    });

    expect(send("foreign-worker", "hi")).rejects.toThrow("no delegated worker");
    expect(send("ghost", "hi")).rejects.toThrow("no delegated worker");
    expect(pendingInboxItems(db, "foreign-worker")).toEqual([]);
  });
});

describe("message_parent tool", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-message-parent-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    events = [];
    bus.subscribe((e) => events.push(e));
    createSession(db, MODEL, { id: "parent" });
    createSession(db, MODEL, {
      id: "worker",
      title: "CVE scan",
      parentSessionId: "parent",
      parentToolCallId: "spawn-1",
    });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const message = (childSessionId: string, text: string): Promise<string> => {
    const set = messageParentTool({ db, childSessionId, bus });
    const messageTool = set[MESSAGE_PARENT_TOOL_NAME] as {
      execute: (
        input: { message: string },
        options: { toolCallId: string; messages: [] },
      ) => Promise<string>;
    };
    return messageTool.execute({ message: text }, { toolCallId: "call_m", messages: [] });
  };

  it("queues a child-sourced message for the parent, carrying the sender's session id", async () => {
    const result = await message("worker", "Report: two advisories, both patched upstream.");

    expect(result).toContain("Delivered");
    const [item] = pendingInboxItems(db, "parent");
    expect(item?.source).toBe("child");
    // The id, not a copied label: the delivery names the worker by its live
    // title wherever the message surfaces.
    expect(item?.fromSessionId).toBe("worker");
    expect(item?.text).toBe("Report: two advisories, both patched upstream.");
    expect(events).toContainEqual({ type: "session.inbox.queued", sessionId: "parent" });
  });

  it("caps the message size so an essay can't flood the parent", () => {
    const set = messageParentTool({ db, childSessionId: "worker", bus });
    const schema = (
      set[MESSAGE_PARENT_TOOL_NAME] as {
        inputSchema: { safeParse: (v: unknown) => { success: boolean } };
      }
    ).inputSchema;
    expect(schema.safeParse({ message: "x".repeat(MESSAGE_PARENT_MAX_LENGTH) }).success).toBe(true);
    expect(schema.safeParse({ message: "x".repeat(MESSAGE_PARENT_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ message: "" }).success).toBe(false);
  });

  it("throws when the session is missing or has no parent", async () => {
    expect(message("ghost", "hi")).rejects.toThrow('session "ghost" not found');
    expect(message("parent", "hi")).rejects.toThrow("no parent to message");
    expect(pendingInboxItems(db, "parent")).toEqual([]);
  });
});
