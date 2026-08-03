import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import type { KiriEvent, SessionStatus } from "../events/index.ts";
import { getSession, updateSessionTitle } from "./store.ts";

/** Length cap for a session title; shared by the tool and the PATCH route. */
export const SESSION_TITLE_MAX_LENGTH = 120;

/**
 * First-party tool that lets a session name itself: `set_session_title` writes
 * the session's title, the display name the session list, activity feed, and
 * search results lead with. Scoped to `sessionId` — a session can only ever
 * retitle itself. Every change publishes `session.updated` so open views
 * refresh at once.
 */
export function sessionTitleTools(
  db: KiriDb,
  sessionId: string,
  publish: (event: KiriEvent) => void,
): ToolSet {
  return {
    set_session_title: tool({
      description:
        "Set this session's title: the short display name shown for the conversation in the session list, activity feed, and search results. Applies immediately and replaces any existing title.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .max(SESSION_TITLE_MAX_LENGTH)
          .describe(
            "The new title: a few words naming what the conversation is about, in sentence case, with no trailing punctuation.",
          ),
      }),
      execute: async ({ title }) => {
        const trimmed = title.trim();
        if (trimmed === "") {
          throw new Error("The title must contain visible characters, not just whitespace.");
        }
        const session = getSession(db, sessionId);
        if (!session) throw new Error(`session "${sessionId}" not found`);
        updateSessionTitle(db, sessionId, trimmed);
        publish({
          type: "session.updated",
          id: sessionId,
          status: session.status as SessionStatus,
        });
        return { title: trimmed };
      },
    }),
  };
}
