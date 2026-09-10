import {
  APICallError,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
  asSchema,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isToolUIPart,
  streamText,
} from "ai";
import { isInboxPart } from "../../shared/inbox-part.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus, SessionStatus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { compactContext } from "./compact-context.ts";
import {
  type ContextCalibration,
  contextSnapshot,
  measuredContextTokens,
  savedContextCalibration,
  withContextCalibration,
  withoutContextCalibration,
} from "./context-calibration.ts";
import { finaliseInterruptedParts } from "./finalise-interrupted-parts.ts";
import { stripImageToolResults } from "./image-tool-results.ts";
import {
  type InboxDelivery,
  type SenderLabelResolver,
  deleteInboxItems,
  expandInboxMessages,
  inboxUIPart,
  insertInboxModelMessages,
  pendingInboxItems,
} from "./inbox.ts";
import type { InstructionContext } from "./instruction-context.ts";
import { contextBudget, estimateContextTokens, historySinceCheckpoint } from "./session-context.ts";
import {
  type Message,
  type Session,
  appendMessage,
  getSession,
  getSessionLabels,
  getSessionMessages,
  setSessionStatus,
  updateMessage,
} from "./store.ts";
import type { StreamRegistry, StreamSink } from "./stream-registry.ts";
import { toonEncodeToolResults } from "./toon-tool-results.ts";
import { stripWriteToolDiffs } from "./write-tool-diffs.ts";

export interface RunTurnDeps {
  /** Shared by the prompt builder and mutation tools; receipts survive approval pauses. */
  instructionContext?: InstructionContext;
  db: KiriDb;
  /** Resolves the session's `provider:model` into a callable model. */
  llmClients: LlmClients;
  /** When supplied, session lifecycle events are published as the turn progresses. */
  bus?: EventBus;
  /** When supplied, the turn is registered so it can be cancelled mid-stream. */
  cancelRegistry?: CancelRegistry;
  /**
   * When supplied, the turn's stream is captured here so a client that reconnects
   * mid-turn (a reload, a second tab) can rejoin the live response. Omit for a
   * turn with no resumable stream.
   */
  streamRegistry?: StreamRegistry;
  /**
   * Resolves the system prompt before each model step and the final handoff,
   * using the current working directory and the turn's original model/effort.
   * Omit for a plain chat with no system prompt.
   */
  buildSystemPrompt?: (session: Session) => string | undefined;
  /**
   * Tools offered to the model this turn. When non-empty, the turn runs as a
   * multi-step loop — the model can call a tool, read its result, and continue —
   * capped at `MAX_TURN_STEPS` and the context budget, followed by a tool-free handoff when it fits.
   * An empty set (the default) is a plain chat:
   * `streamText` runs a single step with no tools. A factory is called with the
   * turn's stream writer as the stream starts, so a tool can emit live progress
   * parts into the response while it runs.
   */
  tools?: ToolSet | ((context: { writer: UIMessageStreamWriter }) => ToolSet);
}

// Upper bound on model⇄tool round-trips in a single turn. With tools, a turn
// loops — call a tool, feed the result back, maybe call again — and this cap
// stops a misbehaving model from looping without end. Generous enough for
// extended tool work: many search-and-reason cycles, or a long series of
// document edits, in one turn.
const MAX_TURN_STEPS = 64;

const STEP_LIMIT_NOTICE = `Kiri stopped this turn at its ${MAX_TURN_STEPS}-step work limit. Work may be incomplete. Completed actions are saved. Send another message to continue from the saved progress.`;

const HANDOFF_PROMPT =
  "The work step limit has been reached. Tools are unavailable. Give a concise handoff: " +
  "what was completed, what remains unfinished or uncertain, and that this turn stopped " +
  "because of the step limit. Do not claim unfinished work is complete or suggest repeating " +
  "completed actions. If an action's outcome is unknown, say it needs verification.";

const CONTEXT_LIMIT_NOTICE =
  "Kiri stopped this turn because context compaction could not free enough working space. " +
  "Work may be incomplete. Completed actions and the full transcript are saved. " +
  "Use a larger-context model or start a new session with the saved progress; do not repeat completed actions.";

const CONTEXT_HANDOFF_PROMPT =
  "Context compaction could not free enough working space. Tools are unavailable. Give a concise handoff: " +
  "what was completed, what remains unfinished or uncertain, and that this turn stopped " +
  "because of the context budget. Do not claim unfinished work is complete or suggest repeating " +
  "completed actions. If an action's outcome is unknown, say it needs verification.";

const UNKNOWN_TOOL_RESULT =
  "The turn failed before this tool's result was recorded. Its action may have completed. " +
  "Verify the current state before deciding whether to retry; do not automatically repeat it.";

// The chunk union `UIMessageStreamWriter.write` accepts. A delivered inbox
// part is written verbatim — its shape is a data chunk — but the union types
// data parts by inferred name, so the literal part needs re-establishing.
type InboxChunk = Parameters<UIMessageStreamWriter["write"]>[0];

export interface RunTurnArgs {
  /** The target session; must not have a turn in flight (the caller rejects a concurrent turn). */
  session: Session;
  /** The incoming user message, persisted before the assistant response streams. */
  userMessage: UIMessage;
}

/** A user's verdict on one of a turn's pending tool-approval requests. */
export interface ToolApprovalDecision {
  /** The id of the tool call the verdict is for. */
  toolCallId: string;
  /** Allow the call to run (true) or refuse it (false). */
  approved: boolean;
  /** Optional note carried back to the model alongside the verdict. */
  reason?: string;
}

export interface ResumeTurnArgs {
  /** The session paused awaiting tool approval; its last message is the assistant turn to resume. */
  session: Session;
  /** Verdicts for the pending tool-approval requests on that assistant message. */
  approvals: ToolApprovalDecision[];
}

export interface StartedTurn {
  /** The streamed assistant response, ready to return from the turn endpoint. */
  response: Response;
  /**
   * Resolves once the turn has fully settled: the assistant message and its
   * usage are persisted and the session has returned to `idle` (or moved to a
   * terminal `failed`/`cancelled`). The route logs a rejection; tests await it.
   */
  done: Promise<void>;
}

// Drizzle types the JSON `parts` column as `unknown`; the cast re-establishes
// the AI SDK part type the rows always hold.

const toUiMessage = (row: Message): UIMessage => ({
  id: row.id,
  role: row.role as UIMessage["role"],
  parts: row.parts as UIMessage["parts"],
});

const errorMessage = (cause: unknown): string => {
  const fallback = cause instanceof Error ? cause.message : String(cause);
  if (!APICallError.isInstance(cause) || !cause.responseBody) return fallback;
  // Compatible backends can return details outside the SDK's error schema.
  // Extract only the message, never request data or the entire response body.
  try {
    const body = JSON.parse(cause.responseBody);
    const detail = body?.detail ?? body?.error?.message ?? body?.error;
    return typeof detail === "string" && detail.trim() ? detail : fallback;
  } catch {
    return fallback;
  }
};

// Read a turn's SSE stream to completion, mirroring each frame into `sink` when
// one is given. Draining server-side guarantees the turn reaches `onFinish` —
// and so persists and settles — even when no client is reading the response (the
// user navigated away, reloaded, or dropped the connection). A turn is only ever
// cancelled by an explicit request through the `CancelRegistry`, never by a lost
// consumer. The sink captures the frames for a client that reconnects mid-turn;
// the turn's `onFinish` closes it — in step with persistence — not the stream's
// end. Any failure is recorded via the stream's own error handling, so it's
// swallowed here; the pump just has to not raise.
async function pumpStream(stream: ReadableStream<string>, sink?: StreamSink): Promise<void> {
  const reader = stream.getReader();
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      sink?.push(next.value);
    }
  } catch {
    // settled through the stream's error path
  } finally {
    reader.releaseLock();
  }
}

// Drain everything queued while the session was out of a turn: each item
// becomes its own user-role message ahead of the turn, so the model reads the
// backlog in arrival order. Rows are deleted only after their messages are
// appended — a crash between the two redelivers rather than loses. Returns
// how many items drained.
function drainBacklog(db: KiriDb, bus: EventBus | undefined, sessionId: string): number {
  const backlog = pendingInboxItems(db, sessionId);
  for (const item of backlog) {
    appendMessage(db, sessionId, {
      role: "user",
      parts: [inboxUIPart(item) as UIMessage["parts"][number]],
    });
  }
  deleteInboxItems(
    db,
    backlog.map((item) => item.id),
  );
  if (backlog.length > 0) bus?.publish({ type: "session.inbox.delivered", sessionId });
  return backlog.length;
}

/**
 * Run one agentic turn: persist the user message, stream the assistant response
 * against the session's model, checkpoint completed steps, and persist partial
 * output on interruption. Returns the AI SDK's streamed response for the route to hand
 * straight to the client, and a `done` promise that settles after persistence.
 *
 * Cancellation rides the shared registry: a cancel aborts the in-flight stream
 * (there is no child process), which lands the turn as `cancelled`. A provider
 * error lands it as `failed`. Either way the session leaves `running`. A dropped
 * client connection does *not* cancel: the stream is drained server-side, so the
 * turn runs to completion and persists whether or not anyone is reading it.
 *
 * Resolving the model can throw (bad id, unknown provider); it does so before
 * any state changes, so the route surfaces it as a clean error with nothing
 * half-persisted.
 */
export async function runTurn(deps: RunTurnDeps, args: RunTurnArgs): Promise<StartedTurn> {
  const { db, llmClients, bus } = deps;
  const { session, userMessage } = args;

  // Resolve before any writes so a bad id rejects with nothing half-persisted.
  const model = llmClients.resolveModel(session.model);

  // Anything queued while the session was idle drains ahead of the message
  // that starts the turn.
  const incomingMessageCount = drainBacklog(db, bus, session.id) + 1;

  // Persist under the message's own id so the client and server agree on it —
  // edit-and-resend truncates the transcript by this id, which only works if the
  // stored row carries the id the client holds rather than a fresh one.
  appendMessage(db, session.id, { role: "user", parts: userMessage.parts }, { id: userMessage.id });
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  // Clear any prior terminal markers: a session resumed after a failed or
  // cancelled turn starts the new turn clean.
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  return streamCore(deps, session, model, incomingMessageCount);
}

/**
 * Start a turn from the session's queued backlog alone — the message-driven
 * wake of a session with no turn in flight. Each queued item becomes its own
 * user-role message (framed at send time by its source) and the model's turn
 * opens on those, with no fresh user message. Clears any prior terminal
 * markers, so a failed session woken by a worker's report starts clean.
 * Returns null without touching the session when nothing is queued — the wake
 * raced an earlier drain. The caller checks the session is out of a turn; the
 * preamble here runs synchronously to the `running` write, so two wakes on
 * one tick can't both start a turn.
 */
export async function runWakeTurn(
  deps: RunTurnDeps,
  args: { session: Session },
): Promise<StartedTurn | null> {
  const { db, llmClients, bus } = deps;
  const { session } = args;

  // Resolve before any writes so a bad id rejects with nothing half-persisted.
  const model = llmClients.resolveModel(session.model);

  const incomingMessageCount = drainBacklog(db, bus, session.id);
  if (incomingMessageCount === 0) return null;
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  return streamCore(deps, session, model, incomingMessageCount);
}

/**
 * Resume a turn paused awaiting tool approval. Applies the user's verdicts to the
 * session's last (assistant) message — each pending tool call flipped to allowed
 * or denied — then streams the continuation: the AI SDK runs the allowed tools,
 * tells the model the denied ones were refused, and the model carries on. The
 * continuation extends that same assistant message in place rather than starting
 * a new one.
 *
 * Throws (before any write) if the session isn't actually awaiting approval, or
 * if no verdict matches a pending request — the route maps either to a 4xx.
 */
export async function resumeTurn(deps: RunTurnDeps, args: ResumeTurnArgs): Promise<StartedTurn> {
  const { db, llmClients, bus } = deps;
  const { session, approvals } = args;

  const model = llmClients.resolveModel(session.model);

  const last = getSessionMessages(db, session.id).at(-1);
  if (!last || last.role !== "assistant") {
    throw new Error(`session "${session.id}" has no turn awaiting tool approval`);
  }
  const { parts, applied } = applyApprovals(last.parts as UIMessage["parts"], approvals);
  if (applied === 0) {
    throw new Error(`session "${session.id}" has no pending tool approval matching the response`);
  }
  updateMessage(db, session.id, last.id, { parts });
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  return streamCore(deps, session, model);
}

// Reason handed to the model when a tool call is denied, so it understands the
// refusal and moves on rather than re-requesting the same call in a loop.
const DENIAL_REASON =
  "The user denied permission to run this tool. Do not retry the same call — continue without it, or ask the user how to proceed.";

// Flip each pending `approval-requested` tool part to `approval-responded`,
// carrying the matching verdict and keeping the approval id the request was
// issued under. A denial with no explicit reason gets a standing one so the
// model is told why. Parts with no matching verdict (and non-tool parts) pass
// through untouched. Returns the rewritten parts and how many verdicts landed,
// so the caller can reject a resume that matched nothing.
function applyApprovals(
  parts: UIMessage["parts"],
  approvals: ToolApprovalDecision[],
): { parts: UIMessage["parts"]; applied: number } {
  const byToolCallId = new Map(approvals.map((a) => [a.toolCallId, a]));
  let applied = 0;
  const next = parts.map((part) => {
    if (!isToolUIPart(part) || part.state !== "approval-requested") return part;
    const decision = byToolCallId.get(part.toolCallId);
    if (!decision) return part;
    applied += 1;
    const reason = decision.approved ? decision.reason : (decision.reason ?? DENIAL_REASON);
    return {
      ...part,
      state: "approval-responded" as const,
      approval: { ...part.approval, approved: decision.approved, reason },
    };
  });
  return { parts: next, applied };
}

// Approval continuations and later checkpoints update the same assistant row.
function persistAssistantMessage(
  db: KiriDb,
  sessionId: string,
  id: string,
  parts: UIMessage["parts"],
  alreadyPersisted: boolean,
  contextTokens?: number,
): void {
  if (alreadyPersisted) {
    // Leave the footprint alone when this turn has none, so the
    // paused message keeps the one its earlier steps recorded.
    updateMessage(db, sessionId, id, {
      parts,
      ...(contextTokens !== undefined ? { contextTokens } : {}),
    });
  } else {
    appendMessage(db, sessionId, { role: "assistant", parts, contextTokens }, { id });
  }
}

// Stream the model's response for an already-prepared turn (the user message
// appended, or the pending approvals applied), checkpointing completed steps.
// Shared by a fresh turn and an approval resume — the only difference is the
// preamble each runs before calling in.
async function streamCore(
  deps: RunTurnDeps,
  session: Session,
  model: ReturnType<LlmClients["resolveModel"]>,
  incomingMessageCount = 0,
): Promise<StartedTurn> {
  const {
    db,
    llmClients,
    bus,
    cancelRegistry,
    streamRegistry,
    buildSystemPrompt,
    tools,
    instructionContext,
  } = deps;

  // A cancel aborts the controller; the registry treats it like any child
  // process, so a cancel that arrives before the stream starts still fires.
  const controller = new AbortController();
  cancelRegistry?.register(session.id);
  cancelRegistry?.setChild(session.id, { kill: () => controller.abort() });

  const rows = getSessionMessages(db, session.id);
  const history = rows.map(toUiMessage);
  const last = history.at(-1);
  const hasPendingApprovals =
    last?.role === "assistant" &&
    last.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested");
  instructionContext?.restore(
    session.status === "waiting" && last?.role === "assistant" ? last.parts : [],
  );
  // Names a child sender in send-time framing by its live label, resolved at
  // most once per sender per turn. A sender since deleted resolves to
  // nothing, and the framing drops the name.
  const senderLabels = new Map<string, string | undefined>();
  const senderLabelFor: SenderLabelResolver = (id) => {
    if (!senderLabels.has(id)) senderLabels.set(id, getSessionLabels(db, [id]).get(id));
    return senderLabels.get(id);
  };
  const contextWindow = await llmClients.contextWindowFor(session.model);

  // The session's effort as this turn's provider reasoning parameters —
  // undefined for a model without reasoning support, which leaves the call
  // without provider options rather than sending parameters blind. Resolved
  // per turn like the model, so a mid-session change applies next turn.
  const providerOptions = await llmClients.reasoningOptionsFor(session.model, session.effort);
  // Inbox items that arrive while the turn runs are delivered at the next
  // step boundary: `prepareStep` (inside `execute` below) injects them into
  // the step's model messages and mirrors each one into the UI stream as its
  // `data-inbox` part — so the live transcript and the persisted message,
  // both assembled from that same stream, carry the delivery at the boundary
  // the model saw it. Insert positions are recorded against the SDK's own
  // step input, which is rebuilt each step without our injections, so every
  // step re-inserts the whole list at positions that stay valid as the turn
  // grows.
  const deliveries: InboxDelivery[] = [];
  const deliveredIds = new Set<string>();

  // Assigned synchronously by the executor below, before any await can run.
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  // Open the resumable-stream sink up front so a near-instant reconnect finds it.
  // The turn captures into it as it drains, and `onFinish` closes it in step with
  // persistence — so a client that loads the just-settled turn from storage gets a
  // 204 on resume and never replays it into a duplicate.
  const sink = streamRegistry?.open(session.id, rows);

  // Assigned synchronously by `execute` below (the SDK invokes it as the stream
  // is created); `onFinish` reads the settled usage off it. Left unassigned only
  // when a tools factory throws, which lands the turn as failed.
  let result: ReturnType<typeof streamText> | undefined;
  let streamError: unknown;
  let checkpointed = false;
  let checkpointFailed = false;
  let stepLimitReached = false;
  let contextLimitReached = false;
  const contextLimitError = new Error(CONTEXT_LIMIT_NOTICE);
  let contextHandoffMessages: ModelMessage[] = [];
  let lastContextTokens: number | undefined;
  let savedCalibration = savedContextCalibration(history);
  let savedSteps = 0;
  let savingWorkStep = false;
  let checkpointReady: (() => void) | undefined;
  let checkpointFinished: (() => void) | undefined;
  const resumedApprovals = new Set(
    last?.role === "assistant"
      ? last.parts
          .filter(isToolUIPart)
          .filter((part) => part.state === "approval-responded" && !part.providerExecuted)
          .map((part) => part.toolCallId)
      : [],
  );
  let approvalsSaved: (() => void) | undefined;
  const acknowledgedIds = new Set<string>();

  // The stream can already contain an inbox delivery for the next model step.
  // Acknowledge only deliveries present in this snapshot, in the same transaction
  // as the transcript, so an interruption can neither lose nor redeliver them.
  const persistProgress = (message: UIMessage, isContinuation: boolean, contextTokens?: number) => {
    const inboxIds = message.parts
      .filter(isInboxPart)
      .map((part) => part.id)
      .filter((id) => deliveredIds.has(id) && !acknowledgedIds.has(id));
    db.transaction(() => {
      persistAssistantMessage(
        db,
        session.id,
        message.id,
        withContextCalibration(message, savedCalibration).parts,
        isContinuation || checkpointed,
        contextTokens,
      );
      deleteInboxItems(db, inboxIds);
    });
    checkpointed = true;
    for (const id of inboxIds) acknowledgedIds.add(id);
    if (inboxIds.length > 0)
      bus?.publish({ type: "session.inbox.delivered", sessionId: session.id });
  };

  const stream = createUIMessageStream<UIMessage>({
    // Surface real error text in the stream and transcript instead of the
    // SDK's masked "An error occurred." default. The masking keeps server
    // internals from leaking to remote clients; kiri is single-user and
    // local, and a tool error's message is the recovery instruction — the
    // model acts on it, so the transcript should show the same thing.
    onError: errorMessage,
    // Passing the history puts the stream in persistence mode: the response
    // message reuses the last message's id when it continues an assistant turn
    // (an approval resume), so the continuation lands on the same row, and a
    // fresh turn gets a stable id the client and server share.
    originalMessages: history,
    // A fresh assistant message gets a unique id here rather than defaulting to
    // the provider's stream id, which some providers reuse across requests and
    // would collide on the message primary key from one turn to the next.
    generateId: () => crypto.randomUUID(),
    execute: async ({ writer }) => {
      try {
        writer.write({ type: "start" });
        // Tools may be supplied ready-made or built against this turn's stream
        // writer, so a tool can emit live progress parts while it runs. With
        // tools, the turn runs as a multi-step loop (call a tool, feed the
        // result back, continue) capped at MAX_TURN_STEPS. An empty set leaves
        // the call tool-less, a single-step plain chat.
        const turnTools = typeof tools === "function" ? tools({ writer }) : tools;
        const hasTools = turnTools !== undefined && Object.keys(turnTools).length > 0;
        const thinking = providerOptions?.anthropic?.thinking;
        const reasoningTokens =
          thinking &&
          typeof thinking === "object" &&
          !Array.isArray(thinking) &&
          typeof thinking.budgetTokens === "number"
            ? thinking.budgetTokens
            : 0;
        const budget = contextBudget(contextWindow, reasoningTokens);
        const toolSchemas = await Promise.all(
          Object.entries(turnTools ?? {}).map(async ([name, t]) => ({
            name,
            description: t.description,
            inputSchema: await asSchema(t.inputSchema).jsonSchema,
          })),
        );
        const modelHistory = toonEncodeToolResults(
          stripWriteToolDiffs(
            stripImageToolResults(withoutContextCalibration(historySinceCheckpoint(history))),
          ),
        );
        const modelMessages = await convertToModelMessages(
          expandInboxMessages(modelHistory, senderLabelFor),
        );
        const incomingMessages =
          incomingMessageCount > 0 ? history.slice(-incomingMessageCount) : [];
        const incomingModelMessages = await convertToModelMessages(
          expandInboxMessages(incomingMessages, senderLabelFor),
        );
        const previousMessageCount = modelMessages.length - incomingModelMessages.length;
        let calibration = savedCalibration;
        let previousRequest: Omit<ContextCalibration, "inputTokens"> | undefined;
        let checkpointMessages: ModelMessage[] = [];
        let compactedThrough = 0;
        const compactionThreshold = Math.floor(budget.workInputTokens * 0.85);
        const prepareContext = (
          messages: ModelMessage[],
          system: string | undefined,
          handoff: boolean,
        ) => {
          const snapshot = contextSnapshot({
            model: session.model,
            contextWindow,
            providerOptions,
            system,
            messages,
            tools: handoff ? [] : toolSchemas,
          });
          const tokens = measuredContextTokens(snapshot, calibration);
          return {
            messages,
            snapshot,
            estimate: snapshot.estimate,
            tokens,
            fits: tokens <= (handoff ? budget.handoffInputTokens : budget.workInputTokens),
          };
        };
        result = streamText({
          model,
          messages: modelMessages,
          onStepFinish: ({ usage }) => {
            lastContextTokens = usage.totalTokens;
            if (
              previousRequest &&
              usage.inputTokens !== undefined &&
              Number.isFinite(usage.inputTokens) &&
              usage.inputTokens > 0
            ) {
              calibration = { ...previousRequest, inputTokens: usage.inputTokens };
              savedCalibration = calibration;
            }
          },
          ...(providerOptions !== undefined ? { providerOptions } : {}),
          ...(hasTools
            ? {
                tools: turnTools,
                // The SDK checks stop conditions only when tool work could
                // continue. A final answer or pending approval at the boundary
                // therefore never spends the handoff allowance.
                stopWhen: ({ steps }) => {
                  stepLimitReached = steps.length >= MAX_TURN_STEPS;
                  return stepLimitReached;
                },
              }
            : {}),
          // Deliver anything queued since the last boundary: inject it into
          // this step's model messages, and write its part into the UI stream
          // so the client shows the interjection mid-turn — at this boundary,
          // where the persisted message will carry it too. Items are delivered
          // once (the backlog row survives until a checkpoint proves persistence,
          // so later boundaries would re-read it) and re-inserted every step,
          // because the SDK rebuilds the step input without our injections.
          prepareStep: async ({ messages, stepNumber }) => {
            // Resumed approvals execute before step zero, without an SDK step
            // boundary. Wait for their results to reach the transcript too.
            if (resumedApprovals.size > 0)
              await new Promise<void>((resolve) => {
                approvalsSaved = resolve;
              });
            // The SDK can prepare its next call before the UI stream has saved
            // the previous step. Summaries must never outrun saved action results.
            if (savedSteps < stepNumber)
              await new Promise<void>((resolve) => {
                checkpointReady = resolve;
              });
            controller.signal.throwIfAborted();
            // Refresh cwd while model and effort still describe the provider
            // call configured when this turn began. Replace the system prompt
            // so rules from a directory we left do not linger.
            let system = buildSystemPrompt?.({
              ...session,
              cwd: getSession(db, session.id)?.cwd ?? null,
            });
            for (const item of pendingInboxItems(db, session.id)) {
              if (deliveredIds.has(item.id)) continue;
              deliveredIds.add(item.id);
              deliveries.push({ item, insertIndex: messages.length });
              writer.write(inboxUIPart(item) as InboxChunk);
            }
            let delivered = insertInboxModelMessages(messages, deliveries, senderLabelFor);
            let current = [...checkpointMessages, ...delivered.slice(compactedThrough)];
            let prepared = prepareContext(current, system, false);
            // Before any work, summarize only the history preceding the incoming
            // messages. Later boundaries summarize completed tool steps as well.
            const beforeTurn = stepNumber === 0 && incomingMessageCount > 0;
            const summaryMessages = beforeTurn ? current.slice(0, previousMessageCount) : current;
            // An unanswered approval must remain a real tool part for its later resume.
            // Summarizing history cannot bring fixed instructions/tools below the
            // target. In that case, keep working while the full request still fits.
            if (
              !hasPendingApprovals &&
              summaryMessages.length > 0 &&
              estimateContextTokens({ system, messages: [], tools: toolSchemas }) <
                compactionThreshold &&
              prepared.tokens >= compactionThreshold
            ) {
              writer.write({
                type: "data-compaction",
                data: { status: "started" },
                transient: true,
              });
              let checkpoint: Awaited<ReturnType<typeof compactContext>>;
              try {
                checkpoint = await compactContext({
                  llmClients,
                  model: session.model,
                  messages: summaryMessages,
                  system,
                  inputBudget: budget.handoffInputTokens,
                  summaryBudget: Math.min(4096, Math.floor(budget.workInputTokens * 0.2)),
                  calibration:
                    calibration?.model === prepared.snapshot.model &&
                    calibration.optionsHash === prepared.snapshot.optionsHash
                      ? calibration
                      : undefined,
                  abortSignal: controller.signal,
                });
              } finally {
                writer.write({
                  type: "data-compaction",
                  data: { status: "finished" },
                  transient: true,
                });
              }
              if (checkpoint && beforeTurn) {
                // Save the excluded inputs with the checkpoint so reloads and
                // approval continuations retain the same request boundary.
                checkpoint.data.pendingMessages = [
                  ...incomingMessages,
                  ...expandInboxMessages(
                    deliveries.map(({ item }) => ({
                      id: item.id,
                      role: "assistant" as const,
                      parts: [inboxUIPart(item) as UIMessage["parts"][number]],
                    })),
                    senderLabelFor,
                  ),
                ];
              }
              const summarized = checkpoint
                ? await convertToModelMessages(
                    expandInboxMessages(
                      historySinceCheckpoint([
                        { id: checkpoint.id, role: "assistant", parts: [checkpoint] },
                      ]),
                      senderLabelFor,
                    ),
                  )
                : [];
              const summaryEstimate = estimateContextTokens({
                system,
                messages: summarized,
                tools: toolSchemas,
              });
              if (
                !checkpoint ||
                summaryEstimate >= compactionThreshold ||
                summaryEstimate >= prepared.estimate
              ) {
                contextLimitReached = true;
                contextHandoffMessages = current;
                throw contextLimitError;
              }
              // This boundary is part of the same transcript, and must be durable
              // before the model can take actions using only its summary.
              const summarySaved = new Promise<void>((resolve) => {
                checkpointFinished = resolve;
              });
              // Clear the old measurement in the same durable boundary as its
              // replaced history, even if the turn stops before another call.
              calibration = undefined;
              savedCalibration = undefined;
              writer.write(checkpoint);
              writer.write({ type: "finish-step" });
              await summarySaved;
              controller.signal.throwIfAborted();
              checkpointMessages = summarized;
              compactedThrough = delivered.length;
              system = buildSystemPrompt?.({
                ...session,
                cwd: getSession(db, session.id)?.cwd ?? null,
              });
              // Steering received during generation belongs after the checkpoint.
              for (const item of pendingInboxItems(db, session.id)) {
                if (deliveredIds.has(item.id)) continue;
                deliveredIds.add(item.id);
                deliveries.push({ item, insertIndex: messages.length });
                writer.write(inboxUIPart(item) as InboxChunk);
              }
              delivered = insertInboxModelMessages(messages, deliveries, senderLabelFor);
              current = [...checkpointMessages, ...delivered.slice(compactedThrough)];
              prepared = prepareContext(current, system, false);
            }
            const receipt = instructionContext?.receipt();
            if (receipt) {
              writer.write({
                type: "data-instructions",
                id: "standing-instructions",
                data: receipt,
              });
            }
            if (!prepared.fits) {
              contextLimitReached = true;
              contextHandoffMessages = current;
              throw contextLimitError;
            }
            previousRequest = prepared.snapshot;
            return { system, messages: prepared.messages };
          },
          abortSignal: controller.signal,
          onError: ({ error }) => {
            if (error !== contextLimitError) streamError ??= error;
          },
        });
        // Forward in order and wait for each checkpoint before proceeding.
        // Merging two streams concurrently could put the handoff ahead of the
        // last tool result. Hold the final finish frame until both have ended.
        for await (const chunk of result.toUIMessageStream({
          onError: errorMessage,
          sendStart: false,
          sendFinish: false,
        })) {
          if (
            chunk.type === "error" &&
            contextLimitReached &&
            chunk.errorText === CONTEXT_LIMIT_NOTICE
          )
            continue;
          let checkpoint: Promise<void> | undefined;
          if (chunk.type === "finish-step") {
            savingWorkStep = true;
            checkpoint = new Promise<void>((resolve) => {
              checkpointFinished = resolve;
            });
          }
          writer.write(chunk);
          if (checkpoint) await checkpoint;
          if (
            (chunk.type === "tool-output-available" ||
              chunk.type === "tool-output-error" ||
              chunk.type === "tool-output-denied") &&
            !(chunk.type === "tool-output-available" && chunk.preliminary) &&
            resumedApprovals.has(chunk.toolCallId)
          ) {
            const approvalSaved = new Promise<void>((resolve) => {
              checkpointFinished = resolve;
            });
            writer.write({ type: "finish-step" });
            await approvalSaved;
            resumedApprovals.delete(chunk.toolCallId);
            if (resumedApprovals.size === 0) approvalsSaved?.();
          }
        }
        if (controller.signal.aborted || streamError !== undefined) return;
        if (!stepLimitReached && !contextLimitReached) {
          writer.write({ type: "finish", finishReason: await result.finishReason });
          return;
        }

        // This runtime notice survives even an empty or failed handoff. Its
        // checkpoint must land before another provider call can start.
        const noticeId = crypto.randomUUID();
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id: noticeId });
        writer.write({
          type: "text-delta",
          id: noticeId,
          delta: `${contextLimitReached ? CONTEXT_LIMIT_NOTICE : STEP_LIMIT_NOTICE}\n\n`,
        });
        writer.write({ type: "text-end", id: noticeId });
        const noticeSaved = new Promise<void>((resolve) => {
          checkpointFinished = resolve;
        });
        writer.write({ type: "finish-step" });
        await noticeSaved;
        if (controller.signal.aborted) return;

        let handoffMessages = contextHandoffMessages;
        if (!contextLimitReached) {
          const delivered = insertInboxModelMessages(
            [...modelMessages, ...(await result.response).messages],
            deliveries,
            senderLabelFor,
          );
          handoffMessages = [...checkpointMessages, ...delivered.slice(compactedThrough)];
        }
        const system = buildSystemPrompt?.({
          ...session,
          cwd: getSession(db, session.id)?.cwd ?? null,
        });
        const handoff = prepareContext(
          [
            ...handoffMessages,
            {
              role: "user",
              content: contextLimitReached ? CONTEXT_HANDOFF_PROMPT : HANDOFF_PROMPT,
            },
          ],
          system,
          true,
        );
        if (!handoff.fits) {
          writer.write({ type: "finish", finishReason: "stop" });
          return;
        }
        result = streamText({
          model,
          system,
          messages: handoff.messages,
          onStepFinish: ({ usage }) => {
            lastContextTokens = usage.totalTokens;
          },
          ...(providerOptions !== undefined ? { providerOptions } : {}),
          // A separate call has no executable tool catalogue, even if a
          // provider ignores the prompt and emits a tool call. No retry can
          // spend another call beyond this one reserved handoff.
          maxRetries: 0,
          abortSignal: controller.signal,
          onError: ({ error }) => {
            streamError ??= error;
          },
        });
        writer.merge(result.toUIMessageStream({ sendStart: false, onError: errorMessage }));
      } catch (cause) {
        // A tools factory that throws fails the turn like a provider error:
        // recorded here so `onFinish` lands it as failed, and rethrown so the
        // SDK streams the real error text to the client.
        streamError = cause;
        throw cause;
      }
    },
    onStepFinish: ({ responseMessage, isContinuation }) => {
      try {
        if (finaliseInterruptedParts(responseMessage.parts) === null) return;
        persistProgress(responseMessage, isContinuation);
      } catch (cause) {
        // The SDK reports checkpoint errors without stopping its tool loop.
        // Abort here so further actions cannot outrun failed persistence.
        checkpointFailed = true;
        streamError = cause;
        controller.abort();
        throw cause;
      } finally {
        // Synthetic summary/approval boundaries save progress without consuming a work step.
        if (savingWorkStep) savedSteps += 1;
        savingWorkStep = false;
        checkpointReady?.();
        checkpointReady = undefined;
        checkpointFinished?.();
        checkpointFinished = undefined;
      }
    },
    onFinish: async ({ responseMessage, isContinuation, isAborted }) => {
      let finalStatus: Exclude<SessionStatus, "running"> | undefined;
      let messagePersisted = checkpointed;
      try {
        const aborted = !checkpointFailed && (isAborted || controller.signal.aborted);
        if (aborted || streamError !== undefined) {
          const status = aborted ? "cancelled" : "failed";
          // Both failure and cancellation retain completed work. An unfinished
          // call's outcome is unknown on failure; recording an error pairs the
          // call for the next model turn without authorising its replay.
          const kept = checkpointFailed
            ? null
            : finaliseInterruptedParts(
                responseMessage.parts,
                aborted ? undefined : UNKNOWN_TOOL_RESULT,
              );
          if (kept !== null) {
            persistProgress({ ...responseMessage, parts: kept }, isContinuation);
            messagePersisted = true;
          }
          setSessionStatus(db, session.id, status, {
            finishedAt: new Date(),
            error:
              streamError === undefined
                ? undefined
                : {
                    message: errorMessage(streamError),
                    ...(!aborted && (contextLimitReached || stepLimitReached)
                      ? { code: contextLimitReached ? "context_limit" : "step_limit" }
                      : {}),
                  },
          });
          finalStatus = status;
          return;
        }
        // The context fill the gauge reads is the last model call's total
        // tokens — not the per-step sum, which over-counts a multi-step tool
        // turn. A budget stop can skip a provider call entirely; in that case
        // preserve the most recent recorded footprint rather than inventing usage.
        persistProgress(responseMessage, isContinuation, lastContextTokens);
        messagePersisted = true;
        if (contextLimitReached || stepLimitReached) {
          setSessionStatus(db, session.id, "failed", {
            finishedAt: new Date(),
            error: {
              code: contextLimitReached ? "context_limit" : "step_limit",
              message: contextLimitReached ? CONTEXT_LIMIT_NOTICE : STEP_LIMIT_NOTICE,
            },
          });
          finalStatus = "failed";
          return;
        }
        // A turn that stopped on tool-approval requests hasn't settled: the
        // session is blocked on the user's verdicts, and lists surface that
        // as `waiting` rather than the resting `idle`.
        const settled = responseMessage.parts.some(
          (part) => isToolUIPart(part) && part.state === "approval-requested",
        )
          ? ("waiting" as const)
          : ("idle" as const);
        setSessionStatus(db, session.id, settled);
        finalStatus = settled;
      } catch (cause) {
        // Final persistence can fail after a successful step checkpoint. The
        // turn still stopped: record that failure before notifying its parent.
        setSessionStatus(db, session.id, "failed", {
          finishedAt: new Date(),
          error: { message: errorMessage(cause) },
        });
        finalStatus = "failed";
        throw cause;
      } finally {
        // Close the resumable stream as the turn settles, in step with persisting
        // the message above, so a client reconnecting now replays nothing.
        sink?.close();
        cancelRegistry?.release(session.id);
        if (finalStatus !== undefined && finalStatus !== "waiting") {
          bus?.publish({
            type: "session.turn.settled",
            id: session.id,
            // An empty failed turn must not point at an older reply. Approval
            // continuations retain the same assistant row as their saved work.
            messageId: messagePersisted ? responseMessage.id : null,
            outcome:
              finalStatus === "idle"
                ? "ended"
                : finalStatus === "failed" && (stepLimitReached || contextLimitReached)
                  ? "incomplete"
                  : finalStatus,
          });
        }
        // An idle event can synchronously wake another turn. Release this
        // turn's resources first so cleanup cannot cancel its replacement.
        if (messagePersisted)
          bus?.publish({ type: "session.message.added", sessionId: session.id });
        if (finalStatus !== undefined) {
          bus?.publish({
            type:
              finalStatus === "failed" || finalStatus === "cancelled"
                ? "session.finished"
                : "session.updated",
            id: session.id,
            status: finalStatus,
          });
        }
        settle();
      }
    },
  });

  const response = createUIMessageStreamResponse({
    stream,
    // Drive the stream server-side so the turn always reaches `onFinish` —
    // persisting and settling — even if the client never reads the response — and
    // mirror its frames into the stream registry so a client that reconnects
    // mid-turn (a reload, a second tab) rejoins the live response. A turn is
    // cancelled only by an explicit request (the `CancelRegistry`), never by a
    // dropped connection.
    consumeSseStream: ({ stream }) => {
      void pumpStream(stream, sink);
    },
  });

  return { response, done };
}
