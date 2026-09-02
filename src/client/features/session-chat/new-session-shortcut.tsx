import { useEffect } from "react";
import { useStartSession } from "./use-start-session.ts";

/**
 * Global keyboard shortcut for the new-session action: ⌘N / Ctrl+N starts a
 * session against the default model and opens its chat, from any page — the
 * same action as the rail's `New session` button, which it complements
 * rather than replaces. Renders nothing; mount once at the app root.
 *
 * Browsers reserve plain ⌘N/Ctrl+N for "new window" and act on it before the
 * page sees the key, so the shortcut also accepts the Option/Alt-modified form
 * — ⌥⌘N / Ctrl+Alt+N — which every browser lets through. Matching on the
 * physical key (`code`) rather than `key` is what makes the Option form work:
 * on macOS, Option turns the N key's `key` into a dead-key tilde. Shift is
 * excluded because ⇧⌘N is another reserved browser shortcut (incognito).
 *
 * Inert while a start is already in flight — a held key auto-repeats, and two
 * sessions for one press would be a surprise.
 */
export function NewSessionShortcut(): null {
  const { start, ready, starting } = useStartSession();

  useEffect(() => {
    if (!ready || starting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === "KeyN") {
        event.preventDefault();
        void start();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, starting, start]);

  return null;
}
