import { useEffect, useState } from "react";
import { type RunDetail, type RunListEntry, fetchRun } from "../api.ts";

interface RunFeedProps {
  runs: RunListEntry[];
}

/**
 * Reverse-chronological feed of runs. Each row collapses to a one-line
 * header and expands inline to show the run detail (definition snapshot,
 * per-node envelope, traces, materials).
 */
export function RunFeed({ runs }: RunFeedProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => setExpanded((prev) => (prev === id ? null : id));

  if (runs.length === 0) {
    return (
      <section>
        <h2>Runs</h2>
        <p>No runs yet.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Runs</h2>
      <ul className="run-list">
        {runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} expanded={expanded === run.id} onToggle={() => toggle(run.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RunRowProps {
  run: RunListEntry;
  expanded: boolean;
  onToggle: () => void;
}

const formatDuration = (startedAt: string, finishedAt: string | null): string => {
  if (!finishedAt) return "running…";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return `${ms} ms`;
};

function RunRow({ run, expanded, onToggle }: RunRowProps) {
  return (
    <>
      <button type="button" className="run-row" onClick={onToggle}>
        <span className={`status status-${run.status}`}>{run.status}</span>
        <span className="run-name">
          {run.workflowName}
          {run.isOrphan && <span className="orphan-badge"> (deleted)</span>}
        </span>
        <span className="run-time">{new Date(run.startedAt).toLocaleString()}</span>
        <span className="run-duration">{formatDuration(run.startedAt, run.finishedAt)}</span>
      </button>
      {expanded && <RunDetailView runId={run.id} />}
    </>
  );
}

function RunDetailView({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRun(runId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <div className="run-detail">Error: {error}</div>;
  if (!detail) return <div className="run-detail">Loading…</div>;

  return (
    <div className="run-detail">
      {detail.run.error && (
        <Section title="Run error">
          <pre>{detail.run.error.message}</pre>
        </Section>
      )}
      <Section title="Definition snapshot">
        <pre>{JSON.stringify(detail.run.definitionSnapshot, null, 2)}</pre>
      </Section>
      {detail.nodes.map((node) => (
        <Section key={node.id} title={`Node ${node.index} · ${node.kind} · ${node.status}`}>
          {node.error && (
            <Field label="error">
              <pre>{node.error.message}</pre>
            </Field>
          )}
          <Field label="output">
            <pre>
              {typeof node.output === "string" ? node.output : JSON.stringify(node.output, null, 2)}
            </pre>
          </Field>
          {node.traces && (
            <>
              <Field label={`stdout (${node.traces.durationMs.toFixed(1)} ms)`}>
                <pre>{node.traces.stdout}</pre>
              </Field>
              {node.traces.stderr && (
                <Field label="stderr">
                  <pre>{node.traces.stderr}</pre>
                </Field>
              )}
            </>
          )}
          <Field label="materials.source">
            <pre>{node.materials.source}</pre>
          </Field>
        </Section>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      {children}
    </div>
  );
}
