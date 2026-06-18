import { type UIMessage, convertToModelMessages, streamText } from "ai";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import {
  type Message,
  type Session,
  addTurnUsage,
  appendMessage,
  getSessionMessages,
  setSessionStatus,
} from "./store.ts";

export interface RunTurnDeps {
  db: KiriDb;
  /** Resolves the session's `provider:model` into a callable model. */
  llmClients: LlmClients;
  /** When supplied, session lifecycle events are published as the turn progresses. */
  bus?: EventBus;
  /** When supplied, the turn is registered so it can be cancelled mid-stream. */
  cancelRegistry?: CancelRegistry;
  /**
   * Composes the turn's system prompt from the session (its attached persona)
   * and the workspace's instruction files. Omit for a plain chat with no system
   * prompt — the previous behaviour, kept for tests and any caller that wants a
   * bare conversation.
   */
  buildSystemPrompt?: (session: Session) => string | undefined;
}

export interface RunTurnArgs {
  /** The target session; must not have a turn in flight (the caller rejects a concurrent turn). */
  session: Session;
  /** The incoming user message, persisted before the assistant response streams. */
  userMessage: UIMessage;
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

// Read a stream to completion, discarding its content. Draining the turn's SSE
// stream server-side guarantees the turn reaches `onFinish` — and so persists
// and settles — even when no client is reading the response (the user navigated
// away, reloaded, or dropped the connection). A turn is only ever cancelled by
// an explicit request through the `CancelRegistry`, never by a lost consumer.
// Any failure is recorded via the stream's own error handling, so it's swallowed
// here; the drain just has to not raise.
async function drainStream(stream: ReadableStream<string>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // discard
    }
  } catch {
    // settled through the stream's error path
  } finally {
    reader.releaseLock();
  }
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
  const { db, llmClients, bus, cancelRegistry, buildSystemPrompt } = deps;
  const { session, userMessage } = args;

  const model = llmClients.resolveModel(session.model);

  appendMessage(db, session.id, { role: "user", parts: userMessage.parts });
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  // Clear any prior terminal markers: a session resumed after a failed or
  // cancelled turn starts the new turn clean.
  setSessionStatus(db, session.id, "running", { error: null, finishedAt: null });
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  // A cancel aborts the controller; the registry treats it like any child
  // process, so a cancel that arrives before the stream starts still fires.
  const controller = new AbortController();
  cancelRegistry?.register(session.id);
  cancelRegistry?.setChild(session.id, { kill: () => controller.abort() });

  const history = getSessionMessages(db, session.id).map(toUiMessage);
  const modelMessages = await convertToModelMessages(history);

  // Compose the turn's system prompt — the kiri core layer, the workspace's
  // `kiri.md`, and any persona attached to the session — read fresh from disk
  // each turn. Undefined when no builder is wired (a bare chat with no system
  // prompt), which leaves `streamText` to send the messages alone.
  const system = buildSystemPrompt?.(session);
  let streamError: unknown;
  const result = streamText({
    model,
    system,
    messages: modelMessages,
    abortSignal: controller.signal,
    onError: ({ error }) => {
      streamError = error;
    },
  });

  // Assigned synchronously by the executor below, before any await can run.
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const response = result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage, isAborted }) => {
      try {
        const aborted = isAborted || controller.signal.aborted;
        if (aborted || streamError !== undefined) {
          const status = aborted ? "cancelled" : "failed";
          setSessionStatus(db, session.id, status, {
            finishedAt: new Date(),
            error: streamError === undefined ? undefined : { message: errorMessage(streamError) },
          });
          bus?.publish({ type: "session.finished", id: session.id, status });
          return;
        }
        const usage = await result.totalUsage;
        const turnUsage = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        };
        appendMessage(db, session.id, {
          role: "assistant",
          parts: responseMessage.parts,
          usage: turnUsage,
        });
        addTurnUsage(db, session.id, turnUsage);
        setSessionStatus(db, session.id, "idle");
        bus?.publish({ type: "session.message.added", sessionId: session.id });
        bus?.publish({ type: "session.updated", id: session.id, status: "idle" });
      } finally {
        cancelRegistry?.release(session.id);
        settle();
      }
    },
    // Drive the stream server-side so the turn always reaches `onFinish` —
    // persisting and settling — even if the client never reads the response.
    // A turn is cancelled only by an explicit request (the `CancelRegistry`),
    // never by a dropped connection: navigating away, reloading, or losing the
    // connection leaves it running to completion for the client to pick back up.
    consumeSseStream: ({ stream }) => {
      void drainStream(stream);
    },
  });

  return { response, done };
}
