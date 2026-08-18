import type { KiriDb } from "../db/index.ts";
import type { KiriEvent, SessionStatus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { createLogger } from "../log.ts";
import { getSession, updateSessionTitle } from "./store.ts";

const log = createLogger("sessions");

/** Length cap for a session title; shared by title generation and the PATCH route. */
export const SESSION_TITLE_MAX_LENGTH = 120;

// The opening message is context for a title, not content to process in full —
// a cap keeps a pasted document from ballooning the call.
const USER_TEXT_MAX_LENGTH = 2000;

const TITLE_INSTRUCTION =
  "Name the conversation that opens with the user message below. " +
  "Reply with the title only: a few words (at most eight) naming what the conversation is about, " +
  "in sentence case, with no quotes and no trailing punctuation.";

// A model that ignores the no-quotes instruction still yields a clean title.
const stripQuotes = (title: string): string => title.replace(/^["'“”]+|["'“”]+$/g, "").trim();

/**
 * Generate and persist a title for an untitled session with a one-off text
 * generation against `model`, publishing `session.updated` on success. Fired
 * alongside the session's first turn, not awaited by it — so it never delays
 * or fails a turn: every error is logged and swallowed, and a title the user
 * set in the meantime is never overwritten.
 */
export async function generateSessionTitle(opts: {
  db: KiriDb;
  llmClients: Pick<LlmClients, "generateText">;
  sessionId: string;
  /** The text of the session's opening user message. */
  userText: string;
  /** The `provider:model` reference to generate with. */
  model: string;
  publish?: (event: KiriEvent) => void;
}): Promise<void> {
  const { db, llmClients, sessionId, userText, model, publish } = opts;
  try {
    const { text } = await llmClients.generateText({
      model,
      prompt: `${TITLE_INSTRUCTION}\n\n${userText.slice(0, USER_TEXT_MAX_LENGTH)}`,
    });
    // First line only — a chatty model's explanation never becomes the title.
    const title = stripQuotes(text.trim().split("\n", 1)[0] ?? "").slice(
      0,
      SESSION_TITLE_MAX_LENGTH,
    );
    if (title === "") return;
    // Re-read at write time: the turn streams while this call runs, and a
    // title the user set through the UI in that window wins.
    const session = getSession(db, sessionId);
    if (!session || session.title !== null) return;
    updateSessionTitle(db, sessionId, title);
    publish?.({
      type: "session.updated",
      id: sessionId,
      status: session.status as SessionStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`session ${sessionId}: title generation failed: ${message}`);
  }
}
