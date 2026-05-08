import { useEffect, useState } from "react";
import { type RunDetail, type RunListEntry, type StepMaterials, fetchRun } from "../api.ts";

interface RunFeedProps {
  runs: RunListEntry[];
}

/**
 * Reverse-chronological feed of runs. Each row collapses to a one-line
 * header and expands inline to show the run detail (definition snapshot,
 * per-step envelope, traces, materials).
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
      {detail.steps.map((step) => (
        <Section key={step.id} title={`Step ${step.index} · ${step.kind} · ${step.status}`}>
          {step.error && (
            <Field label="error">
              <pre>{step.error.message}</pre>
            </Field>
          )}
          <Field label="output">
            <pre>
              {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
            </pre>
          </Field>
          {step.traces && (
            <>
              <Field label={`stdout (${step.traces.durationMs.toFixed(1)} ms)`}>
                <pre>{step.traces.stdout}</pre>
              </Field>
              {step.traces.stderr && (
                <Field label="stderr">
                  <pre>{step.traces.stderr}</pre>
                </Field>
              )}
            </>
          )}
          <MaterialsView materials={step.materials} />
        </Section>
      ))}
    </div>
  );
}

function MaterialsView({ materials }: { materials: StepMaterials }) {
  if (materials.kind === "use") {
    return (
      <>
        <Field label={`bundle (${materials.bundle})`}>
          <pre>{Object.keys(materials.files).join("\n") || "(empty)"}</pre>
        </Field>
        {Object.entries(materials.files).map(([name, source]) => (
          <Field key={name} label={`materials.${name}`}>
            <pre>{source}</pre>
          </Field>
        ))}
      </>
    );
  }
  return (
    <Field label="materials.source">
      <pre>{materials.source}</pre>
    </Field>
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
