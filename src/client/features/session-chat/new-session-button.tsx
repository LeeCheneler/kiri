import { Button } from "../../design-system/actions/button.tsx";
import { useStartSession } from "./use-start-session.ts";

// ⌥⌘N on Apple platforms, Ctrl+Alt+N elsewhere — cosmetic only; the shortcut
// listener accepts either modifier everywhere.
const SHORTCUT_LABEL = /mac/i.test(navigator.platform) ? "⌥⌘N" : "Ctrl+Alt+N";

/**
 * One-click new-session action — the rail's button over `useStartSession`.
 * Disabled, with a hint, when no models are configured. Pass `projectId` to
 * create the session within that project — the project page's variant. Only
 * the rail variant advertises the keyboard shortcut: the shortcut starts a
 * project-less session, so on a project page it would promise the wrong thing.
 */
export function NewSessionButton({ projectId }: { projectId?: string } = {}) {
  const { start, ready, starting } = useStartSession(projectId);

  return (
    <Button
      variant="primary"
      disabled={!ready}
      pending={starting}
      pendingLabel="Starting…"
      onClick={() => void start()}
      title={ready ? undefined : "Configure an LLM provider to start a session"}
    >
      New session{projectId === undefined ? ` (${SHORTCUT_LABEL})` : null}
    </Button>
  );
}
