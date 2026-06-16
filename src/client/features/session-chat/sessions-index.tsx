import { useState } from "react";
import { useLocation } from "wouter";
import { createSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";
import { SessionRow } from "./session-row.tsx";

/**
 * Sessions index route content: start a new session against a chosen model,
 * above the reverse-chronological list of existing sessions. `now` is
 * injectable so tests render deterministic relative timestamps.
 */
export function SessionsIndex({ now }: { now?: Date }) {
  return (
    <section>
      <Breadcrumb items={[]} current="Sessions" />
      <div className="mt-6">
        <NewSession />
      </div>
      <div className="mt-10">
        <SessionList now={now} />
      </div>
    </section>
  );
}

function NewSession() {
  const models = useModels();
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState("");
  const [starting, setStarting] = useState(false);

  if (models.isPending) return <LoadingState>Loading models…</LoadingState>;
  if (models.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load models: {models.error.message}
      </p>
    );
  }

  const available = models.data.models;
  if (available.length === 0) {
    return (
      <EmptyState>
        No models available. Configure a provider in llm-providers.yaml to start a session.
      </EmptyState>
    );
  }

  const selected = chosen || available[0]?.id || "";
  const start = async () => {
    setStarting(true);
    try {
      const { session } = await createSession(selected);
      navigate(`/sessions/${session.id}`);
    } catch {
      // Re-enable the control so the user can retry; on success we navigate away.
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select label="Model" value={selected} onChange={setChosen}>
        {available.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </Select>
      <Button
        variant="primary"
        pending={starting}
        pendingLabel="Starting…"
        onClick={() => void start()}
      >
        New session
      </Button>
    </div>
  );
}

function SessionList({ now }: { now?: Date }) {
  const feed = useSessionsFeed();

  if (feed.isPending) return <LoadingState>Loading sessions…</LoadingState>;
  if (feed.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load sessions: {feed.error.message}
      </p>
    );
  }

  const sessions = feed.data;
  if (sessions.length === 0) return <EmptyState>No sessions yet.</EmptyState>;

  return (
    <div>
      <Eyebrow tone="muted">Sessions</Eyebrow>
      <ul className="mt-3 space-y-4">
        {sessions.map((session) => (
          <li key={session.id}>
            <SessionRow session={session} now={now} />
          </li>
        ))}
      </ul>
    </div>
  );
}
