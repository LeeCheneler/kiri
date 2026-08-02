import { useState } from "react";
import { useLocation } from "wouter";
import { createSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";

/**
 * One-click new-session action. Starts a session against a default model and
 * navigates to its chat, no model picker in the way (the model is swappable
 * once inside). With model tiers configured the session starts on tanto for
 * each configured modality — text and image alike; without them the default
 * is the most recent session's model, falling back to the first available
 * text-output model (only those can drive a session).
 * Disabled, with a hint, when no models are configured.
 */
export function NewSessionButton() {
  const [, navigate] = useLocation();
  const models = useModels();
  const sessions = useSessionsFeed();
  const [starting, setStarting] = useState(false);

  const tiers = models.data?.tiers;
  const defaultModel =
    tiers?.text?.tanto ??
    sessions.data?.[0]?.model ??
    models.data?.models.find((model) => model.output === "text")?.id;
  const defaultImageModel = tiers?.image?.tanto;

  const start = async () => {
    if (defaultModel === undefined) return;
    setStarting(true);
    try {
      const { session } = await createSession(defaultModel, defaultImageModel);
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
