import { useState } from "react";
import { useLocation } from "wouter";
import { createSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";

/**
 * One-click new-session action. Starts a session against a default model and
 * navigates to its chat, no model picker in the way (the model is swappable
 * once inside). With model shortcuts configured the session starts on the
 * first shortcut for each configured modality — text and image alike; without
 * them the default is the most recent session's model, falling back to the
 * first available text-output model (only those can drive a session).
 * Disabled, with a hint, when no models are configured. Pass `projectId` to
 * create the session within that project — the project page's variant.
 */
export function NewSessionButton({ projectId }: { projectId?: string } = {}) {
  const [, navigate] = useLocation();
  const models = useModels();
  const sessions = useSessionsFeed();
  const [starting, setStarting] = useState(false);

  const shortcuts = models.data?.shortcuts;
  const defaultModel =
    Object.values(shortcuts?.text ?? {})[0] ??
    sessions.data?.[0]?.model ??
    models.data?.models.find((model) => model.output === "text")?.id;
  const defaultImageModel = Object.values(shortcuts?.image ?? {})[0];

  const start = async () => {
    if (defaultModel === undefined) return;
    setStarting(true);
    try {
      const { session } = await createSession(defaultModel, defaultImageModel, projectId);
      navigate(`/sessions/${session.id}`);
    } catch {
      // Swallow the error; the button re-enables below so the user can retry.
    } finally {
      // The button lives in the persistent left nav, so it survives the
      // navigate — always clear the pending state.
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
