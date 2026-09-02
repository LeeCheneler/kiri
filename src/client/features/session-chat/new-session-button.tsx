import { Button } from "../../design-system/actions/button.tsx";
import { useStartSession } from "./use-start-session.ts";

// ⌥⌘N on Apple platforms, Ctrl+Alt+N elsewhere — cosmetic only; the shortcut
// listener accepts either modifier everywhere.
const SHORTCUT_LABEL = /mac/i.test(navigator.platform) ? "⌥⌘N" : "Ctrl+Alt+N";

/**
 * One-click new-session action — the rail's button over `useStartSession`,
 * advertising the keyboard shortcut that does the same thing. The session
 * lands in the project the current page is scoped to, if any. Disabled, with
 * a hint, when no models are configured.
 */
export function NewSessionButton() {
  const { start, ready, starting } = useStartSession();

  return (
    <Button
      variant="primary"
      disabled={!ready}
      pending={starting}
      pendingLabel="Starting…"
      onClick={() => void start()}
      title={ready ? undefined : "Configure an LLM provider to start a session"}
    >
      + New session ({SHORTCUT_LABEL})
    </Button>
  );
}
