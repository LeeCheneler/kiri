import { type ToolSet, type UIMessage, tool } from "ai";
import { z } from "zod";
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
 * model, and a parent-turn cancel cascades into it. A failed or cancelled
 * child resolves to a note rather than hanging or throwing, so the parent
 * model can always carry on.
 */
export function delegateTool(deps: DelegateToolDeps): ToolSet {
  const { db, parentSessionId, childTurnDeps, bus, cancelRegistry } = deps;
  return {
    [DELEGATE_TOOL_NAME]: tool({
      description:
        "The first-call route for research. A comparison, a roundup or comprehensive breakdown, a latest-news check, anything answered by gathering from more than one place: delegate it before running any search, fetch, or read of your own — doing multi-call research in the conversation instead is a mistake. The tool hands the task to a separate worker session — the same model as you, holding the tools the user allows to run without approval — that does the legwork in its own context and returns only a written report, so the conversation holds the findings rather than the working; it runs while you wait, and the user watches it live. The worker cannot see this conversation: write the task as a complete brief, stating the goal, every specific it needs, and the shape of report you want back. The report is the delegated work, done — answer from it rather than re-running any of it yourself. Only a single specific lookup, whose one result you use directly, belongs inline.",
      inputSchema: z.object({
        task: z
          .string()
          .min(1)
          .describe(
            "The complete brief for the worker: the goal, every detail it needs (it cannot see this conversation), and the shape of the report you want back.",
          ),
      }),
      execute: async ({ task }, { toolCallId, abortSignal }) => {
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
          child = createSession(db, parent.model, {
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
      },
    }),
  };
}
