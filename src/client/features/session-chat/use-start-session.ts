import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { createSession } from "../../api.ts";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";

/**
 * The one-click new-session action, shared by the rail button and the global
 * keyboard shortcut. `start` creates a session against a default model and
 * navigates to its chat, no model picker in the way (the model is swappable
 * once inside). With model shortcuts configured the session starts on the
 * first shortcut for each configured modality — text and image alike; without
 * them the default is the most recent session's model, falling back to the
 * first available text-output model (only those can drive a session).
 * `ready` is false, and `start` a no-op, until a default model resolves —
 * nothing is configured, or the models haven't loaded yet. Pass `projectId`
 * to create the session within that project.
 */
export function useStartSession(projectId?: string): {
  start: () => Promise<void>;
  ready: boolean;
  starting: boolean;
} {
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

  const start = useCallback(async () => {
    if (defaultModel === undefined) return;
    setStarting(true);
    try {
      const { session } = await createSession(defaultModel, defaultImageModel, projectId);
      navigate(`/sessions/${session.id}`);
    } catch {
      // Swallow the error; the caller re-enables so the user can retry.
    } finally {
      // The rail button survives the navigate — always clear the pending state.
      setStarting(false);
    }
  }, [defaultModel, defaultImageModel, projectId, navigate]);

  return { start, ready: defaultModel !== undefined, starting };
}
