import { type ToolSet, type UIMessage, tool } from "ai";
import { z } from "zod";
import { MODEL_TIER_NAMES, type ModelTiers } from "../config/schema.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { createSession, findChildByToolCall, getSession, getSessionMessages } from "./store.ts";
import { type RunTurnDeps, runTurn } from "./turn.ts";

/** Name the model calls the delegation tool by; also its standing-permission key. */
export const DELEGATE_TOOL_NAME = "delegate";

export interface DelegateToolDeps {
  db: KiriDb;
  /** The session whose turn offers this tool; children it spawns carry it as their parent. */
  parentSessionId: string;
  /**
   * Assembles the turn dependencies a child session runs against: its tool
   * set (the parent catalogue narrowed to standing-allow tools — a worker
   * runs unattended, so an approval can never surface) and the worker system
   * prompt over those tools.
   */
  childTurnDeps: (childSessionId: string) => RunTurnDeps;
  bus?: EventBus;
  /** Lets a parent-turn cancel cascade into the child's in-flight turn. */
  cancelRegistry?: CancelRegistry;
  /**
   * The configured text model tiers. Present, the tool takes a required
   * `model` tier name and the worker runs the tier's model, resolved at
   * spawn; absent, the prop is not offered and the worker inherits the
   * parent's model.
   */
  textTiers?: ModelTiers;
}

// The report is the last assistant message's text parts. A worker that ended
// without any text produced no report — surfaced honestly rather than as "".
function extractReport(db: KiriDb, childSessionId: string): string | null {
  const last = getSessionMessages(db, childSessionId).at(-1);
  if (!last || last.role !== "assistant") return null;
  const text = (last.parts as UIMessage["parts"])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
  return text === "" ? null : text;
}

/**
 * The first-party `delegate` tool: hands a self-contained task to a child
 * session that runs it server-side — its own turn loop, context window, and
 * step budget — and resolves with only the worker's written report, so the
 * parent's context holds the findings rather than the working. The child is
 * created idempotently against the spawning tool call, runs the parent's
 * model — or, when text tiers are configured, the model of a required tier
 * the caller names, resolved at spawn — and a parent-turn cancel cascades
 * into it. A failed or cancelled child resolves to a note rather than hanging
 * or throwing, so the parent model can always carry on.
 */
export function delegateTool(deps: DelegateToolDeps): ToolSet {
  const { db, parentSessionId, childTurnDeps, bus, cancelRegistry, textTiers } = deps;
  const description =
    "The first-call route for research. A comparison, a roundup or comprehensive breakdown, a latest-news check, anything answered by gathering from more than one place: delegate it before running any search, fetch, or read of your own — doing multi-call research in the conversation instead is a mistake. The tool hands the task to a separate worker session — the same model as you, holding the tools the user allows to run without approval — that does the legwork in its own context and returns only a written report, so the conversation holds the findings rather than the working; it runs while you wait, and the user watches it live. The worker cannot see this conversation: write the task as a complete brief, stating the goal, every specific it needs, and the shape of report you want back. The report is the delegated work, done — answer from it rather than re-running any of it yourself. Only a single specific lookup, whose one result you use directly, belongs inline.";
  const taskField = z
    .string()
    .min(1)
    .describe(
      "The complete brief for the worker: the goal, every detail it needs (it cannot see this conversation), and the shape of the report you want back.",
    );
  const run = async (
    task: string,
    childModel: string | undefined,
    { toolCallId, abortSignal }: { toolCallId: string; abortSignal?: AbortSignal },
  ) => {
    const parent = getSession(db, parentSessionId);
    if (!parent) throw new Error(`session "${parentSessionId}" not found`);
    // Idempotent on the spawning call: a retried call re-attaches to the
    // child it already created rather than spawning a duplicate — and a
    // child still mid-turn must not be driven into a second, concurrent one.
    const existing = findChildByToolCall(db, parentSessionId, toolCallId);
    if (existing?.status === "running") {
      throw new Error("the delegated task for this call is already running");
    }
    let child = existing;
    if (!child) {
      child = createSession(db, childModel ?? parent.model, {
        parentSessionId,
        parentToolCallId: toolCallId,
      });
      bus?.publish({ type: "session.started", id: child.id });
    }

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: task }],
    };
    const { done } = await runTurn(childTurnDeps(child.id), { session: child, userMessage });
    // Cancelling the parent turn should stop the work it started: an abort
    // maps onto the same cancel path the session cancel endpoint uses, and
    // the child's turn finalises as `cancelled` before `done` resolves.
    // An abort that landed while the turn was being set up never fires the
    // listener (an already-aborted signal dispatches nothing), so check
    // the flag as well — the turn registered with the cancel registry
    // before its first await, so the cascade lands either way.
    const onAbort = () => cancelRegistry?.requestCancel(child.id);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    try {
      await done;
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }

    const settled = getSession(db, child.id);
    if (settled?.status === "cancelled") {
      return "The delegated task was cancelled before it finished.";
    }
    if (settled?.status === "failed") {
      const message = (settled.error as { message?: string } | null)?.message;
      return `The delegated task failed${message ? `: ${message}` : "."} Continue without it, or tell the user what went wrong.`;
    }
    return (
      extractReport(db, child.id) ?? "The delegated worker finished without producing a report."
    );
  };

  // With text tiers configured the tier is a required choice — sizing the
  // worker is part of writing the brief — and resolves to the tier's model at
  // spawn. Without them the prop doesn't exist and the worker inherits the
  // parent's model.
  if (textTiers) {
    return {
      [DELEGATE_TOOL_NAME]: tool({
        description,
        inputSchema: z.object({
          task: taskField,
          model: z
            .enum(MODEL_TIER_NAMES)
            .describe(
              "Which model runs the worker. tanto — smallest and fastest: mechanical, fully-specified tasks with no judgement calls (fetch and extract, reformat, enumerate, apply a stated edit or pattern, run a command and report output). katana — the default for ordinary work: research strands, routine coding against a clear spec, multi-step tool use. odachi — largest and slowest: only for tasks whose result depends on reasoning depth (genuine ambiguity, conflicting sources, subtle code correctness, debugging from symptoms, cross-cutting design). Undersizing forces a rerun; oversizing wastes time and cost for identical output.",
            ),
        }),
        execute: ({ task, model }, ctx) => run(task, textTiers[model], ctx),
      }),
    };
  }
  return {
    [DELEGATE_TOOL_NAME]: tool({
      description,
      inputSchema: z.object({ task: taskField }),
      execute: ({ task }, ctx) => run(task, undefined, ctx),
    }),
  };
}
