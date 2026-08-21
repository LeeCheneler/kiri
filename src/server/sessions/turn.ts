import {
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isToolUIPart,
  stepCountIs,
  streamText,
} from "ai";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { cullToolHistory, currentContextTokens } from "./cull-tool-results.ts";
import { finaliseCancelledParts } from "./finalise-cancelled-parts.ts";
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
import {
  type Message,
  type Session,
  appendMessage,
  getSessionLabels,
  getSessionMessages,
  setSessionStatus,
  updateMessage,
} from "./store.ts";
import type { StreamRegistry, StreamSink } from "./stream-registry.ts";
import { toonEncodeToolResults } from "./toon-tool-results.ts";
import { stripWriteToolDiffs } from "./write-tool-diffs.ts";

export interface RunTurnDeps {
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
   * Composes the turn's system prompt from the session and the workspace's
   * instruction files. Omit for a plain chat with no system prompt — the
   * previous behaviour, kept for tests and any caller that wants a bare
   * conversation.
   */
  buildSystemPrompt?: (session: Session) => string | undefined;
  /**
   * Tools offered to the model this turn. When non-empty, the turn runs as a
   * multi-step loop — the model can call a tool, read its result, and continue —
   * capped at `MAX_TURN_STEPS`. An empty set (the default) is a plain chat:
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
const MAX_TURN_STEPS = 32;

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

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

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
 * against the session's model, and persist that response plus its token usage
 * on completion. Returns the AI SDK's streamed response for the route to hand
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
  drainBacklog(db, bus, session.id);

  // Persist under the message's own id so the client and server agree on it —
  // edit-and-resend truncates the transcript by this id, which only works if the
  // stored row carries the id the client holds rather than a fresh one.
  appendMessage(db, session.id, { role: "user", parts: userMessage.parts }, { id: userMessage.id });
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  // Clear any prior terminal markers: a session resumed after a failed or
  // cancelled turn starts the new turn clean.
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  return streamCore(deps, session, model);
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

  if (drainBacklog(db, bus, session.id) === 0) return null;
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  return streamCore(deps, session, model);
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

// Persist a turn's assistant message. A continuation extends the assistant
// message that paused for approval — update it in place with this turn's
// footprint. Otherwise it's a new assistant message, persisted under the id the
// stream assigned it.
function persistAssistantMessage(
  db: KiriDb,
  sessionId: string,
  id: string,
  parts: UIMessage["parts"],
  isContinuation: boolean,
  contextTokens?: number,
): void {
  if (isContinuation) {
    // Leave the footprint alone when this turn has none (a cancel), so the
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
// appended, or the pending approvals applied) and persist it on completion.
// Shared by a fresh turn and an approval resume — the only difference is the
// preamble each runs before calling in.
async function streamCore(
  deps: RunTurnDeps,
  session: Session,
  model: ReturnType<LlmClients["resolveModel"]>,
): Promise<StartedTurn> {
  const { db, llmClients, bus, cancelRegistry, streamRegistry, buildSystemPrompt, tools } = deps;

  // A cancel aborts the controller; the registry treats it like any child
  // process, so a cancel that arrives before the stream starts still fires.
  const controller = new AbortController();
  cancelRegistry?.register(session.id);
  cancelRegistry?.setChild(session.id, { kill: () => controller.abort() });

  const rows = getSessionMessages(db, session.id);
  const history = rows.map(toUiMessage);
  // Names a child sender in send-time framing by its live label, resolved at
  // most once per sender per turn. A sender since deleted resolves to
  // nothing, and the framing drops the name.
  const senderLabels = new Map<string, string | undefined>();
  const senderLabelFor: SenderLabelResolver = (id) => {
    if (!senderLabels.has(id)) senderLabels.set(id, getSessionLabels(db, [id]).get(id));
    return senderLabels.get(id);
  };
  // Past the cull ratio of the model's context window, send the model a
  // trimmed history — older tool results replaced by a short notice — to
  // claw back token budget.
  // The untrimmed `history` still feeds persistence below, so nothing stored is
  // lost. The window is unknown for some providers (then this no-ops).
  const contextWindow = await llmClients.contextWindowFor(session.model);
  const culledHistory = cullToolHistory(history, {
    contextTokens: currentContextTokens(rows),
    contextWindow,
  });
  // Three further send-time savings on top of culling, all leaving the
  // untouched `history` to feed persistence below: drop the app-only diff
  // from filesystem write results (the model already knows the change from
  // the call's input), drop the image payload from generate_image results
  // (the image is for the user, not the model), then re-encode surviving
  // JSON tool results as TOON wherever that is smaller — per result, so it
  // never enlarges one.
  const modelHistory = toonEncodeToolResults(
    stripWriteToolDiffs(stripImageToolResults(culledHistory)),
  );
  // Expand delivered inbox parts back into the framed user messages the live
  // turn saw, so a later turn replays the interleaving faithfully.
  const modelMessages = await convertToModelMessages(
    expandInboxMessages(modelHistory, senderLabelFor),
  );

  // Compose the turn's system prompt — the kiri core layer, the workspace's
  // `kiri.md`, and the `AGENTS.md` chain covering the session's working
  // directory — read fresh from disk each turn. Undefined when no
  // builder is wired (a bare chat with no system
  // prompt), which leaves `streamText` to send the messages alone.
  const system = buildSystemPrompt?.(session);
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
  const sink = streamRegistry?.open(session.id);

  // Assigned synchronously by `execute` below (the SDK invokes it as the stream
  // is created); `onFinish` reads the settled usage off it. Left unassigned only
  // when a tools factory throws, which lands the turn as failed.
  let result: ReturnType<typeof streamText> | undefined;
  let streamError: unknown;

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
    execute: ({ writer }) => {
      try {
        // Tools may be supplied ready-made or built against this turn's stream
        // writer, so a tool can emit live progress parts while it runs. With
        // tools, the turn runs as a multi-step loop (call a tool, feed the
        // result back, continue) capped at MAX_TURN_STEPS. An empty set leaves
        // the call tool-less, a single-step plain chat.
        const turnTools = typeof tools === "function" ? tools({ writer }) : tools;
        const hasTools = turnTools !== undefined && Object.keys(turnTools).length > 0;
        result = streamText({
          model,
          system,
          messages: modelMessages,
          ...(providerOptions !== undefined ? { providerOptions } : {}),
          ...(hasTools ? { tools: turnTools, stopWhen: stepCountIs(MAX_TURN_STEPS) } : {}),
          // Deliver anything queued since the last boundary: inject it into
          // this step's model messages, and write its part into the UI stream
          // so the client shows the interjection mid-turn — at this boundary,
          // where the persisted message will carry it too. Items are delivered
          // once (the backlog row survives until `onFinish` proves persistence,
          // so later boundaries would re-read it) and re-inserted every step,
          // because the SDK rebuilds the step input without our injections.
          prepareStep: ({ messages }) => {
            for (const item of pendingInboxItems(db, session.id)) {
              if (deliveredIds.has(item.id)) continue;
              deliveredIds.add(item.id);
              deliveries.push({ item, insertIndex: messages.length });
              writer.write(inboxUIPart(item) as InboxChunk);
            }
            if (deliveries.length === 0) return undefined;
            return { messages: insertInboxModelMessages(messages, deliveries, senderLabelFor) };
          },
          abortSignal: controller.signal,
          onError: ({ error }) => {
            streamError = error;
          },
        });
        writer.merge(result.toUIMessageStream({ onError: errorMessage }));
      } catch (cause) {
        // A tools factory that throws fails the turn like a provider error:
        // recorded here so `onFinish` lands it as failed, and rethrown so the
        // SDK streams the real error text to the client.
        streamError = cause;
        throw cause;
      }
    },
    onFinish: async ({ responseMessage, isContinuation, isAborted }) => {
      // Delivered items leave the inbox only once their streamed parts are
      // persisted; a turn that persists nothing (a failure, or a cancel that
      // kept nothing) leaves them queued for redelivery instead.
      const settleDeliveries = () => {
        if (deliveries.length === 0) return;
        deleteInboxItems(
          db,
          deliveries.map((delivery) => delivery.item.id),
        );
        bus?.publish({ type: "session.inbox.delivered", sessionId: session.id });
      };
      try {
        const aborted = isAborted || controller.signal.aborted;
        if (aborted || streamError !== undefined) {
          const status = aborted ? "cancelled" : "failed";
          // A cancelled turn keeps what it got through: the partial assistant
          // message — text, finished tool calls and their results — is
          // persisted so the next turn (and a reload) still has the work the
          // user interrupted, rather than the model starting over blind. The
          // parts are finalised first so every issued tool call carries a
          // result. Token usage is skipped: the aborted stream never settles
          // it. A failed turn persists nothing, as before.
          const kept = aborted ? finaliseCancelledParts(responseMessage.parts) : null;
          if (kept !== null) {
            persistAssistantMessage(db, session.id, responseMessage.id, kept, isContinuation);
            settleDeliveries();
          }
          setSessionStatus(db, session.id, status, {
            finishedAt: new Date(),
            error: streamError === undefined ? undefined : { message: errorMessage(streamError) },
          });
          if (kept !== null) bus?.publish({ type: "session.message.added", sessionId: session.id });
          bus?.publish({ type: "session.finished", id: session.id, status });
          return;
        }
        // The context fill the gauge reads is the last model call's total
        // tokens — not the per-step sum, which over-counts a multi-step tool
        // turn (each step re-sends the history). `result` is always assigned
        // on this path: only a tools-factory throw leaves it unset, and that
        // records a `streamError` handled above.
        const lastStep = await result?.usage;
        const contextTokens = lastStep?.totalTokens;
        persistAssistantMessage(
          db,
          session.id,
          responseMessage.id,
          responseMessage.parts,
          isContinuation,
          contextTokens,
        );
        settleDeliveries();
        // A turn that stopped on tool-approval requests hasn't settled: the
        // session is blocked on the user's verdicts, and lists surface that
        // as `waiting` rather than the resting `idle`.
        const settled = responseMessage.parts.some(
          (part) => isToolUIPart(part) && part.state === "approval-requested",
        )
          ? ("waiting" as const)
          : ("idle" as const);
        setSessionStatus(db, session.id, settled);
        bus?.publish({ type: "session.message.added", sessionId: session.id });
        bus?.publish({ type: "session.updated", id: session.id, status: settled });
      } finally {
        // Close the resumable stream as the turn settles, in step with persisting
        // the message above, so a client reconnecting now replays nothing.
        sink?.close();
        cancelRegistry?.release(session.id);
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
