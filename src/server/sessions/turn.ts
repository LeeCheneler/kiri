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
}

export interface RunTurnArgs {
  /** The target session; must be idle (the caller rejects concurrent turns). */
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

/**
 * Run one agentic turn: persist the user message, stream the assistant response
 * against the session's model, and persist that response plus its token usage
 * on completion. Returns the AI SDK's streamed response for the route to hand
 * straight to the client, and a `done` promise that settles after persistence.
 *
 * Cancellation rides the shared registry: a cancel aborts the in-flight stream
 * (there is no child process), which lands the turn as `cancelled`. A provider
 * error lands it as `failed`. Either way the session leaves `running`.
 *
 * Resolving the model can throw (bad id, unknown provider); it does so before
 * any state changes, so the route surfaces it as a clean error with nothing
 * half-persisted.
 */
export async function runTurn(deps: RunTurnDeps, args: RunTurnArgs): Promise<StartedTurn> {
  const { db, llmClients, bus, cancelRegistry } = deps;
  const { session, userMessage } = args;

  const model = llmClients.resolveModel(session.model);

  appendMessage(db, session.id, { role: "user", parts: userMessage.parts });
  bus?.publish({ type: "session.message.added", sessionId: session.id });
  setSessionStatus(db, session.id, "running");
  bus?.publish({ type: "session.updated", id: session.id, status: "running" });

  // A cancel aborts the controller; the registry treats it like any child
  // process, so a cancel that arrives before the stream starts still fires.
  const controller = new AbortController();
  cancelRegistry?.register(session.id);
  cancelRegistry?.setChild(session.id, { kill: () => controller.abort() });

  const history = getSessionMessages(db, session.id).map(toUiMessage);
  const modelMessages = await convertToModelMessages(history);

  // No system prompt yet — the agent layer (system prompt, tools, params)
  // arrives with the `agents/*.yaml` pillar; a session is a plain model chat.
  let streamError: unknown;
  const result = streamText({
    model,
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
  });

  return { response, done };
}
