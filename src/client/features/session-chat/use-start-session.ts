import { useCallback, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { createSession } from "../../api.ts";
import { useModels, useSession, useSessionsFeed } from "../../state/sessions.ts";

/**
 * The project the current page is scoped to: the id from any route under
 * `/projects/:id` (the project page, its articles, its memories), or the
 * owning project of the session on any `/sessions/:id` page. Undefined
 * anywhere else — the projects index, a project-less session — and null
 * while a session page's project is still loading, so callers can hold off
 * rather than guess.
 */
export function useProjectScope(): string | undefined | null {
  const [, projectParams] = useRoute("/projects/:id/*?");
  const [, sessionParams] = useRoute("/sessions/:id/*?");
  const session = useSession(sessionParams?.id);
  if (projectParams) return projectParams.id;
  if (!sessionParams) return undefined;
  if (session.isPending) return null;
  // A session that can't be read (a stale link, a 404) scopes nothing rather
  // than holding the action disabled forever.
  return session.data?.session.projectId ?? undefined;
}

/**
 * The one-click new-session action, shared by the rail button and the global
 * keyboard shortcut. `start` creates a session against a default model and
 * navigates to its chat, no model picker in the way (the model is swappable
 * once inside). With model shortcuts configured the session starts on the
 * first shortcut for each configured modality — text and image alike; without
 * them the default is the most recent session's model, falling back to the
 * first available text-output model (only those can drive a session).
 * `ready` is false, and `start` a no-op, until a default model resolves —
 * nothing is configured, or the models haven't loaded yet.
 *
 * The session lands in whichever project the current page is scoped to (see
 * `useProjectScope`), so "new session" means "new session here": inside the
 * project you're looking at or working in, project-less everywhere else.
 * `ready` also waits for that scope to resolve.
 */
export function useStartSession(): {
  start: () => Promise<void>;
  ready: boolean;
  starting: boolean;
} {
  const [, navigate] = useLocation();
  const projectId = useProjectScope();
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
    if (defaultModel === undefined || projectId === null) return;
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

  return { start, ready: defaultModel !== undefined && projectId !== null, starting };
}
