import { type ToolSet, type UIMessage, tool } from "ai";
import { z } from "zod";
import {
  type DelegateRole,
  type ModelDelegates,
  configuredDelegateRoles,
} from "../config/schema.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import { EFFORT_LEVELS, type Effort } from "../llm/index.ts";
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
   * The configured delegate models by role. With at least one role
   * configured, the tool takes a required `model` role name and the worker
   * runs that role's model, resolved at spawn; with none, the prop is not
   * offered and the worker inherits the parent's model.
   */
  delegates?: ModelDelegates;
}

// The sizing prose per delegate role, composed into the `model` prop's
// description for whichever roles are configured.
const ROLE_PROSE: Record<DelegateRole, string> = {
  quick:
    "quick — the lightest: mechanical, fully-specified tasks with no judgement calls (fetch and extract, reformat, enumerate, apply a stated edit or pattern, run a command and report output).",
  daily:
    "daily — the default for ordinary work: research strands, routine coding against a clear spec, multi-step tool use.",
  deep: "deep — the heaviest: only for tasks whose result depends on reasoning depth (genuine ambiguity, conflicting sources, subtle code correctness, debugging from symptoms, cross-cutting design).",
};

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
 * created idempotently against the spawning tool call, titled from the
 * required `title` the call states, runs the parent's
 * model — or, when delegate models are configured, the model of a required
 * role the caller names, resolved at spawn — at a required effort level the
 * call states, and a parent-turn cancel cascades into it. A failed or cancelled child resolves to a note rather than hanging
 * or throwing, so the parent model can always carry on.
 */
export function delegateTool(deps: DelegateToolDeps): ToolSet {
  const { db, parentSessionId, childTurnDeps, bus, cancelRegistry, delegates } = deps;
  const description =
    "The first-call route for research. A comparison, a roundup or comprehensive breakdown, a latest-news check, anything answered by gathering from more than one place: delegate it before running any search, fetch, or read of your own — doing multi-call research in the conversation instead is a mistake. The tool hands the task to a separate worker session — the same model as you, holding the tools the user allows to run without approval — that does the legwork in its own context and returns only a written report, so the conversation holds the findings rather than the working; it runs while you wait, and the user watches it live. The worker cannot see this conversation: write the task as a complete brief, stating the goal, every specific it needs, and the shape of report you want back. The report is the delegated work, done — answer from it rather than re-running any of it yourself. Only a single specific lookup, whose one result you use directly, belongs inline.";
  const titleField = z
    .string()
    .min(1)
    .describe(
      "A short human-readable name for the delegated task — a few words, a specific label, not a sentence. It names the work wherever the delegation surfaces, so make it identify this task among others.",
    );
  const taskField = z
    .string()
    .min(1)
    .describe(
      "The complete brief for the worker: the goal, every detail it needs (it cannot see this conversation), and the shape of the report you want back.",
    );
  const effortField = z
    .enum(EFFORT_LEVELS)
    .describe(
      "How hard the worker's model reasons on this task. low — mechanical, fully-specified work where the steps are already known. medium — the everyday default for ordinary research and coding. high — work whose answer benefits from deliberate reasoning. xhigh — the hardest work, where result quality outweighs time and cost. max — the absolute ceiling, on providers that distinguish one from xhigh. Independent of which model runs the worker; ignored by models without reasoning support.",
    );
  const run = async (
    title: string,
    task: string,
    childModel: string | undefined,
    effort: Effort,
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
        effort,
        title,
        // The worker picks up where the parent is working, not the config
        // default — a delegated task refers to the same tree the parent sees.
        ...(parent.cwd !== null ? { cwd: parent.cwd } : {}),
        // A project parent's worker sees the same shared corpus — read-only,
        // since the article write tools are withheld from children.
        ...(parent.projectId !== null ? { projectId: parent.projectId } : {}),
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

  // With delegate models configured the role is a required choice — sizing
  // the worker is part of writing the brief — and resolves to the role's
  // model at spawn. Without them the prop doesn't exist and the worker
  // inherits the parent's model.
  const roles = configuredDelegateRoles(delegates);
  if (roles.length > 0) {
    return {
      [DELEGATE_TOOL_NAME]: tool({
        description,
        inputSchema: z.object({
          title: titleField,
          task: taskField,
          model: z
            .enum(roles as [DelegateRole, ...DelegateRole[]])
            .describe(
              `Which model runs the worker. ${roles.map((role) => ROLE_PROSE[role]).join(" ")} Undersizing forces a rerun; oversizing wastes time and cost for identical output.`,
            ),
          effort: effortField,
        }),
        execute: ({ title, task, model, effort }, ctx) =>
          run(title, task, delegates?.[model], effort, ctx),
      }),
    };
  }
  return {
    [DELEGATE_TOOL_NAME]: tool({
      description,
      inputSchema: z.object({ title: titleField, task: taskField, effort: effortField }),
      execute: ({ title, task, effort }, ctx) => run(title, task, undefined, effort, ctx),
    }),
  };
}
