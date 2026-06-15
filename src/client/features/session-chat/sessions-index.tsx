import { useState } from "react";
import { useLocation } from "wouter";
import { type SessionStatus, createSession } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, useSessionsFeed } from "../../state/sessions.ts";

// Session lifecycle mapped onto the shared status vocabulary: a running turn
// reads as "working", the resting state as "idle".
const SESSION_STATUS: Record<SessionStatus, StatusKind> = {
  idle: "idle",
  running: "working",
  failed: "failed",
  cancelled: "cancelled",
};

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
            <StatusBlock status={SESSION_STATUS[session.status]}>
              {/* Lead with the first message as the session's identifier; before
                  one is sent there's nothing to show, so fall back to the id. */}
              <HeadlineLink href={`/sessions/${session.id}`}>
                {session.preview ?? session.id.slice(0, 8)}
              </HeadlineLink>
              <div className="mt-1">
                <Meta>
                  <Status status={SESSION_STATUS[session.status]} />
                  <span>{session.model}</span>
                  <span>{formatRelativeTime(session.startedAt, now)}</span>
                </Meta>
              </div>
            </StatusBlock>
          </li>
        ))}
      </ul>
    </div>
  );
}
