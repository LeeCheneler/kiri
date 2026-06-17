import { useCallback, useEffect, useState } from "react";

// Composer drafts live under one namespaced key per session, so a draft is tied
// to its conversation and survives a reload.
const keyFor = (sessionId: string) => `kiri:session-draft:${sessionId}`;

/** The unsent composer draft saved for a session, or "" when there is none. */
export function readSessionDraft(sessionId: string): string {
  return localStorage.getItem(keyFor(sessionId)) ?? "";
}

/** Persist a session's unsent composer draft; an empty draft clears the key. */
export function writeSessionDraft(sessionId: string, text: string): void {
  if (text === "") localStorage.removeItem(keyFor(sessionId));
  else localStorage.setItem(keyFor(sessionId), text);
}

/** Drop a session's saved draft — once it's sent, or the session is deleted. */
export function clearSessionDraft(sessionId: string): void {
  writeSessionDraft(sessionId, "");
}

/**
 * Bind a session's composer draft to local storage: returns the stored draft
 * (seeded on mount, re-synced when `sessionId` changes since the chat view
 * doesn't remount on a route swap), a setter that writes through to storage, and
 * a clear for when the message is sent.
 */
export function useSessionDraft(sessionId: string): {
  draft: string;
  setDraft: (text: string) => void;
  clearDraft: () => void;
} {
  const [draft, setStored] = useState(() => readSessionDraft(sessionId));

  useEffect(() => {
    setStored(readSessionDraft(sessionId));
  }, [sessionId]);

  const setDraft = useCallback(
    (text: string) => {
      setStored(text);
      writeSessionDraft(sessionId, text);
    },
    [sessionId],
  );

  const clearDraft = useCallback(() => {
    setStored("");
    clearSessionDraft(sessionId);
  }, [sessionId]);

  return { draft, setDraft, clearDraft };
}
