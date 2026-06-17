import { useState } from "react";
import { useLocation } from "wouter";
import { createSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";

/**
 * One-click new-session action. Starts a session against a default model — the
 * most recent session's model, falling back to the first available model — and
 * navigates to its chat, no model picker in the way (the model is swappable
 * once inside, as is the persona). Disabled, with a hint, when no models are
 * configured.
 */
export function NewSessionButton() {
  const [, navigate] = useLocation();
  const models = useModels();
  const sessions = useSessionsFeed();
  const [starting, setStarting] = useState(false);

  const defaultModel = sessions.data?.[0]?.model ?? models.data?.models[0]?.id;

  const start = async () => {
    if (defaultModel === undefined) return;
    setStarting(true);
    try {
      const { session } = await createSession(defaultModel);
      navigate(`/sessions/${session.id}`);
    } catch {
      // Re-enable so the user can retry; on success we navigate away.
      setStarting(false);
    }
  };

  return (
    <Button
      variant="primary"
      disabled={defaultModel === undefined}
      pending={starting}
      pendingLabel="Starting…"
      onClick={() => void start()}
      title={
        defaultModel === undefined ? "Configure an LLM provider to start a session" : undefined
      }
    >
      + New session
    </Button>
  );
}
