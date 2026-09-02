import { Button } from "../../design-system/actions/button.tsx";
import { useStartSession } from "./use-start-session.ts";

/**
 * One-click new-session action — the rail's button over `useStartSession`.
 * Disabled, with a hint, when no models are configured. Pass `projectId` to
 * create the session within that project — the project page's variant.
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
      + New session
    </Button>
  );
}
