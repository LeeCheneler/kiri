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
import { enqueueInboxItem } from "./inbox.ts";
import { createSession, findChildByToolCall, getSession, getSessionChildren } from "./store.ts";
import { type RunTurnDeps, runTurn } from "./turn.ts";

/** Name the model calls the delegation tool by; also its standing-permission key. */
export const DELEGATE_TOOL_NAME = "delegate";

/** Name of the parent-side tool that messages a delegated worker. */
export const MESSAGE_WORKER_TOOL_NAME = "message_worker";

/** Name of the child-side tool that messages the delegating parent. */
export const MESSAGE_PARENT_TOOL_NAME = "message_parent";

/** How many of a session's delegated workers may run at once. */
export const MAX_RUNNING_CHILDREN = 5;

/**
 * Hard cap on one `message_parent` payload, so a worker's essay can't flood
 * the parent's context — the report is meant to be a tight synthesis.
 */
export const MESSAGE_PARENT_MAX_LENGTH = 8_000;

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

// What the spawning call resolves with: the handle the parent steers by, and
// the shape of everything that comes back.
const spawnedResult = (title: string, childSessionId: string): string =>
  `Delegated "${title}" to a worker session, id ${childSessionId}. It runs in the background — spawning it does not block this turn, and cancelling this turn does not stop it. Its progress, questions, and results arrive here as messages from the worker; a message that lands after you end your turn starts a new one for you. Steer it, nudge it, or answer its questions with ${MESSAGE_WORKER_TOOL_NAME} and that session id.`;

/**
 * The first-party `delegate` tool: hands a self-contained task to a child
 * session that runs it server-side — its own turn loop, context window, and
 * step budget — and resolves immediately with the child's session id. The
 * worker runs detached from the spawning turn: everything it has to say —
 * progress, questions, and its result — arrives as inbox messages that weave
 * into the parent's running turn or wake it once it has ended, so the
 * conversation holds the findings rather than the working. The child is
 * created idempotently against the spawning tool call, titled from the
 * required `title` the call states, runs the parent's model — or, when
 * delegate models are configured, the model of a required role the caller
 * names, resolved at spawn — at a required effort level the call states.
 * Concurrent workers per session are capped at `MAX_RUNNING_CHILDREN`.
 *
 * Ships with `message_worker`, the parent-side half of the conversation:
 * steer a worker, ask for progress, or answer its question by session id.
 */
export function delegateTool(deps: DelegateToolDeps): ToolSet {
  const { db, parentSessionId, childTurnDeps, bus, delegates } = deps;
  const description =
    "The first-call route for research. A comparison, a roundup or comprehensive breakdown, a latest-news check, anything answered by gathering from more than one place: delegate it before running any search, fetch, or read of your own — doing multi-call research in the conversation instead is a mistake. The tool hands the task to a separate worker session — the same model as you, holding the tools the user allows to run without approval — that does the legwork in its own context, and returns the worker's session id immediately: the worker runs in the background while you carry on, and the user watches it live. Its progress, questions, and results arrive in this conversation as messages from it — mid-turn if you are still working, or waking you if you have ended your turn, so once your workers are spawned and nothing else needs you, tell the user what is underway and end your turn. The worker cannot see this conversation: write the task as a complete brief, stating the goal, every specific it needs, and the shape of report you want back. Only a single specific lookup, whose one result you use directly, belongs inline.";
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
    { toolCallId }: { toolCallId: string },
  ) => {
    const parent = getSession(db, parentSessionId);
    if (!parent) throw new Error(`session "${parentSessionId}" not found`);
    // Idempotent on the spawning call: a retried call re-attaches to the
    // child it already created rather than spawning a duplicate.
    const existing = findChildByToolCall(db, parentSessionId, toolCallId);
    if (existing) return spawnedResult(title, existing.id);
    // The cap counts live workers only — a settled one has already reported
    // (or been noticed dead) and frees its slot.
    const running = getSessionChildren(db, parentSessionId).filter(
      (child) => child.status === "running",
    );
    if (running.length >= MAX_RUNNING_CHILDREN) {
      throw new Error(
        `you already have ${running.length} workers running — the limit. Wait for one to message its result (end your turn if nothing else needs you), then delegate the rest.`,
      );
    }
    const child = createSession(db, childModel ?? parent.model, {
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

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: task }],
    };
    // Starting the turn is awaited — a model that can't resolve fails the
    // spawn as a tool error the parent can act on — but the turn itself runs
    // detached: the worker never pins the parent's turn, and cancelling the
    // parent doesn't touch it. A failed worker turn reaches the parent as the
    // system-authored failure notice (delegation messaging), not through this
    // call. `done` always resolves (the turn settles it in a finally), so
    // the handle is deliberately dropped rather than awaited.
    const { done } = await runTurn(childTurnDeps(child.id), { session: child, userMessage });
    void done;

    return spawnedResult(title, child.id);
  };

  const messageWorker = tool({
    description:
      "Message one of your delegated workers, by the session id `delegate` returned: steer it mid-task, ask what's taking so long, or answer a question it messaged you. The message weaves into the worker's turn if it is still running, or starts a new turn for it if it has finished — so you can also use this to send a settled worker a follow-up on the task it already holds. Keep it purposeful: answer questions promptly, nudge a worker that has gone quiet, and skip idle chatter — every message costs the worker a context detour.",
    inputSchema: z.object({
      sessionId: z.string().min(1).describe("The worker's session id, as `delegate` returned it."),
      message: z
        .string()
        .min(1)
        .describe("What to tell or ask the worker. It arrives labelled as from you."),
    }),
    execute: async ({ sessionId, message }: { sessionId: string; message: string }) => {
      const child = getSession(db, sessionId);
      if (!child || child.parentSessionId !== parentSessionId) {
        throw new Error(
          `no delegated worker of this conversation has session id "${sessionId}" — use the id the delegate call returned`,
        );
      }
      // Captured before the publish: the queued event can start the worker's
      // wake turn synchronously, and the useful answer is what the message
      // found, not the turn it caused.
      const status = child.status;
      enqueueInboxItem(db, sessionId, { source: "parent", text: message });
      bus?.publish({ type: "session.inbox.queued", sessionId });
      if (status === "running") {
        return "Delivered: the worker is mid-turn, so the message weaves in at its next step.";
      }
      if (status === "waiting") {
        return "Queued: the worker is paused on a tool approval, which only the user can resolve — the message delivers when they do.";
      }
      if (status === "cancelled") {
        return "Queued, but the worker was cancelled by the user and will not run again on its own — the message delivers only if it is resumed.";
      }
      return "Delivered: the worker was not mid-turn, so the message starts a new turn for it.";
    },
  });

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
      [MESSAGE_WORKER_TOOL_NAME]: messageWorker,
    };
  }
  return {
    [DELEGATE_TOOL_NAME]: tool({
      description,
      inputSchema: z.object({ title: titleField, task: taskField, effort: effortField }),
      execute: ({ title, task, effort }, ctx) => run(title, task, undefined, effort, ctx),
    }),
    [MESSAGE_WORKER_TOOL_NAME]: messageWorker,
  };
}

export interface MessageParentToolDeps {
  db: KiriDb;
  /** The delegated worker session whose turn offers this tool. */
  childSessionId: string;
  bus?: EventBus;
}

/**
 * The child-side half of delegation messaging: `message_parent` queues a
 * message for the session that delegated this worker's task — progress when
 * a long task hits a milestone, a question when genuinely blocked, and
 * always the result before the turn ends. Size-capped so a worker's essay
 * can't flood the parent's context. The delivery is the inbox's affair:
 * mid-turn it weaves into the parent's work, otherwise it wakes the parent.
 */
export function messageParentTool(deps: MessageParentToolDeps): ToolSet {
  const { db, childSessionId, bus } = deps;
  return {
    [MESSAGE_PARENT_TOOL_NAME]: tool({
      description:
        "Message the session that delegated your task. This is how everything you have to say gets back: progress when a long task passes a real milestone, a question when you are genuinely blocked on something only the parent can answer, and — always — your result, messaged before you end your turn. A reply you write without messaging it reaches no one. Keep every message a tight synthesis, never a dump; the parent acts on what you send, so lead with the answer.",
      inputSchema: z.object({
        message: z
          .string()
          .min(1)
          .max(MESSAGE_PARENT_MAX_LENGTH)
          .describe(
            `The message: a progress note, a blocked question, or your result. Hard cap ${MESSAGE_PARENT_MAX_LENGTH} characters — distil, don't truncate.`,
          ),
      }),
      execute: async ({ message }: { message: string }) => {
        const child = getSession(db, childSessionId);
        if (!child) throw new Error(`session "${childSessionId}" not found`);
        if (child.parentSessionId === null) {
          throw new Error("this session has no parent to message");
        }
        enqueueInboxItem(db, child.parentSessionId, {
          source: "child",
          fromSessionId: child.id,
          text: message,
        });
        bus?.publish({ type: "session.inbox.queued", sessionId: child.parentSessionId });
        return "Delivered to the session that delegated your task.";
      },
    }),
  };
}
