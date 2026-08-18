import { useCallback, useRef, useState } from "react";
import { tidyDraft } from "../../api.ts";
import { useModels } from "../../state/sessions.ts";

/** What the tidy action exposes to its controls and to the composer's shortcut. */
export interface TidyDraftState {
  /** The action is on offer: a utility model is configured. */
  available: boolean;
  /** A tidy is in flight. */
  pending: boolean;
  /** The last tidy failed; cleared by the next attempt. */
  error: string | undefined;
  /** The draft is the untouched result of the last tidy, so it can be undone. */
  canUndo: boolean;
  /** Rewrite the draft; a no-op on an empty draft, while pending, or when unavailable. */
  tidy: () => void;
  /** Restore the draft as it was before the last tidy. */
  undo: () => void;
}

/**
 * The composer's tidy action over a controlled draft: rewrites `value`
 * through the utility model and swaps the result in via `onChange`, keeping
 * the pre-tidy text so the swap can be undone until the draft is edited
 * again. A result that lands after the draft changed underneath it is
 * dropped rather than clobbering what the user typed meanwhile. Unavailable
 * (and inert) until the models listing reports a utility model.
 */
export function useTidyDraft(opts: {
  value: string;
  onChange: (value: string) => void;
}): TidyDraftState {
  const { value, onChange } = opts;
  const available = useModels().data?.utility !== undefined;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [last, setLast] = useState<{ before: string; after: string } | null>(null);
  // The live draft, read at resolve time to detect an edit made in flight.
  const latest = useRef(value);
  latest.current = value;

  const tidy = useCallback(() => {
    const text = latest.current;
    if (!available || pending || text.trim() === "") return;
    setPending(true);
    setError(undefined);
    void tidyDraft(text)
      .then((after) => {
        if (latest.current !== text) return;
        setLast({ before: text, after });
        onChange(after);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "tidy failed");
      })
      .finally(() => setPending(false));
  }, [available, pending, onChange]);

  const canUndo = last !== null && last.after === value;
  const undo = useCallback(() => {
    if (last === null) return;
    onChange(last.before);
    setLast(null);
  }, [last, onChange]);

  return { available, pending, error, canUndo, tidy, undo };
}
