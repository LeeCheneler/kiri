import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import type { LlmClients, LlmModel } from "../llm/index.ts";
import { type CancelRegistry, createCancelRegistry } from "../runner/cancel-registry.ts";
import { DELEGATE_TOOL_NAME, type DelegateToolDeps, delegateTool } from "./delegate-tool.ts";
import { createSession, getSession, getSessionMessages, setSessionStatus } from "./store.ts";
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
});

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finishReason = (unified: "stop" | "error") => ({ unified, raw: unified });

// A worker model that replies with `text` — the report the tool extracts.
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

// A worker model that finishes without any text — a report-less run.
const silentModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: "finish", finishReason: finishReason("stop"), usage: usage(2, 0) },
      ]),
    }),
  }) as unknown as LlmModel;

// A worker model whose stream errors, landing the child turn as failed.
const failingModel = (message: string): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: "error", error: new Error(message) },
        { type: "finish", finishReason: finishReason("error"), usage: usage(0, 0) },
      ]),
    }),
  }) as unknown as LlmModel;

// A worker model whose stream stays open until aborted, so a cancel is the
// only way its turn settles.
const pendingModel = (): LlmModel =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t1" });
          controller.enqueue({ type: "text-delta", id: "t1", delta: "wor" });
        },
      }),
    }),
  }) as unknown as LlmModel;

describe("delegate tool", () => {
  let dir: string;
  let db: KiriDb;
  let bus: EventBus;
  let cancelRegistry: CancelRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-delegate-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    bus = createEventBus();
    cancelRegistry = createCancelRegistry();
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
    cancelRegistry,
    childTurnDeps: (childSessionId): RunTurnDeps => {
      capture.childId = childSessionId;
      return { db, llmClients: clientsFor(model), bus, cancelRegistry };
    },
  });

  const invoke = (
    deps: DelegateToolDeps,
    task: string,
    opts: { toolCallId?: string; abortSignal?: AbortSignal; model?: string } = {},
  ): Promise<string> => {
    const set = delegateTool(deps);
    const delegate = set[DELEGATE_TOOL_NAME] as {
      execute: (
        input: { task: string; model?: string },
        options: { toolCallId: string; messages: []; abortSignal?: AbortSignal },
      ) => Promise<string>;
    };
    return delegate.execute(
      { task, model: opts.model },
      { toolCallId: opts.toolCallId ?? "call_1", messages: [], abortSignal: opts.abortSignal },
    );
  };

  it("runs the task in a new child session and resolves with its report", async () => {
    const events: KiriEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const capture: { childId?: string } = {};

    const report = await invoke(
      depsFor(reportingModel("Pelicans are thriving."), capture),
      "Research pelicans",
    );

    expect(report).toBe("Pelicans are thriving.");
    const child = capture.childId ? getSession(db, capture.childId) : undefined;
    expect(child?.parentSessionId).toBe("parent");
    expect(child?.parentToolCallId).toBe("call_1");
    // The child runs the parent's model and settles idle, its transcript
    // holding the task and the report.
    expect(child?.model).toBe(MODEL);
    expect(child?.status).toBe("idle");
    const rows = getSessionMessages(db, child?.id ?? "");
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(events).toContainEqual({ type: "session.started", id: child?.id ?? "" });
  });

  it("spawns the worker on the named tier's model when text tiers are configured", async () => {
    const capture: { childId?: string } = {};
    const deps: DelegateToolDeps = {
      ...depsFor(reportingModel("Done."), capture),
      textTiers: { tanto: "a:small", katana: "a:mid", odachi: "a:big" },
    };

    const report = await invoke(deps, "Quick lookup", { model: "tanto" });

    expect(report).toBe("Done.");
    // The tier resolved to its configured model at spawn — the child stores
    // that id rather than the parent's model.
    expect(capture.childId && getSession(db, capture.childId)?.model).toBe("a:small");
  });

  it("requires the model tier exactly when text tiers are configured", () => {
    const withTiers = delegateTool({
      ...depsFor(reportingModel("")),
      textTiers: { tanto: "a:small", katana: "a:mid", odachi: "a:big" },
    })[DELEGATE_TOOL_NAME] as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };
    expect(withTiers.inputSchema.safeParse({ task: "t" }).success).toBe(false);
    expect(withTiers.inputSchema.safeParse({ task: "t", model: "katana" }).success).toBe(true);
    expect(withTiers.inputSchema.safeParse({ task: "t", model: "wakizashi" }).success).toBe(false);

    const withoutTiers = delegateTool(depsFor(reportingModel("")))[DELEGATE_TOOL_NAME] as {
      inputSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
    };
    const bare = withoutTiers.inputSchema.safeParse({ task: "t" });
    expect(bare.success).toBe(true);
    // Unconfigured, the prop doesn't exist at all — a stray value is dropped.
    const stray = withoutTiers.inputSchema.safeParse({ task: "t", model: "katana" });
    expect(stray.data).toEqual({ task: "t" });
  });

  it("re-attaches to the child a repeated call already created", async () => {
    createSession(db, MODEL, {
      id: "existing",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });

    const report = await invoke(depsFor(reportingModel("Done.")), "Try again");

    expect(report).toBe("Done.");
    // The task ran in the existing child rather than a duplicate.
    const children = db.$client
      .query<{ id: string }, []>("SELECT id FROM sessions WHERE parent_tool_call_id = 'call_1'")
      .all();
    expect(children.map((c) => c.id)).toEqual(["existing"]);
    expect(getSessionMessages(db, "existing").map((r) => r.role)).toEqual(["user", "assistant"]);
  });

  it("refuses to drive a child that is still running", async () => {
    createSession(db, MODEL, {
      id: "busy",
      parentSessionId: "parent",
      parentToolCallId: "call_1",
    });
    setSessionStatus(db, "busy", "running");

    expect(invoke(depsFor(reportingModel("unused")), "Again")).rejects.toThrow("already running");
  });

  it("throws when the parent session is missing", async () => {
    const deps = { ...depsFor(reportingModel("unused")), parentSessionId: "ghost" };
    expect(invoke(deps, "Anything")).rejects.toThrow('session "ghost" not found');
  });

  it("resolves with a cancelled note when the parent turn aborts", async () => {
    const capture: { childId?: string } = {};
    // Resolve once the child's turn is streaming, so the abort lands after the
    // tool has registered its cascade listener.
    const childRunning = new Promise<string>((resolve) => {
      bus.subscribe((e) => {
        if (e.type === "session.updated" && e.status === "running" && e.id !== "parent") {
          resolve(e.id);
        }
      });
    });
    const controller = new AbortController();

    const pending = invoke(depsFor(pendingModel(), capture), "Never finishes", {
      abortSignal: controller.signal,
    });
    await childRunning;
    controller.abort();

    expect(await pending).toContain("cancelled");
    expect(getSession(db, capture.childId ?? "")?.status).toBe("cancelled");
  });

  it("resolves with a failure note carrying the child's error", async () => {
    const note = await invoke(depsFor(failingModel("provider exploded")), "Doomed task");
    expect(note).toContain("The delegated task failed");
    expect(note).toContain("provider exploded");
  });

  it("resolves with a fallback note when the worker produces no report", async () => {
    const note = await invoke(depsFor(silentModel()), "Silent task");
    expect(note).toBe("The delegated worker finished without producing a report.");
  });
});
