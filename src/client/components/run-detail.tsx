import { useState } from "react";
import { Link } from "wouter";
import type { RunDetail, RunListEntry, RunStepRow, StepMaterials } from "../api.ts";
import { formatDuration, formatDurationMs, formatRelativeTime } from "../formatters/format-time.ts";

type StatusKind = "running" | "ok" | "failed" | "cancelled" | "interrupted";

const STRIP_BG: Record<StatusKind, string> = {
  running: "bg-status-running",
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
  interrupted: "bg-status-interrupted",
};

const STATUS_TEXT: Record<StatusKind, string> = {
  running: "text-status-running",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};

const SHELL_PREVIEW_LIMIT = 60;

const runStatus = (run: RunListEntry): StatusKind => run.status;

const stepKindLabel = (step: RunStepRow): string => {
  if (step.materials.kind === "use") return `use: ${step.materials.bundle}`;
  const firstLine = step.materials.source.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  const truncated =
    trimmed.length > SHELL_PREVIEW_LIMIT ? `${trimmed.slice(0, SHELL_PREVIEW_LIMIT)}…` : trimmed;
  return `sh: ${truncated}`;
};

/**
 * Editorial detail view for a single run. The header promotes the feed
 * row to page-header scale: a thicker status strip on the left, the
 * status word as a coloured kicker, the workflow name in Fraunces, and
 * a single line of metadata in mono. Run-level failures render above
 * the step list so they're not buried in a disclosure. Each step is a
 * collapsible row carrying its envelope (stdout, stderr, error) and
 * the materials snapshot — the bytes that produced the run.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 *
 * `onCancel`, when supplied, surfaces a cancel button in the header
 * while the run is `running`. The handler resolves on accepted-cancel
 * (HTTP 202) and rejects with the server error otherwise — the button
 * shows a brief inline message in the rejected case.
 */
export function RunDetailView({
  detail,
  now,
  onCancel,
}: {
  detail: RunDetail;
  now?: Date;
  onCancel?: () => Promise<unknown>;
}) {
  const { run, steps } = detail;
  const status = runStatus(run);
  const regularSteps = steps.filter((s) => !s.isSummary);
  const summaryStep = steps.find((s) => s.isSummary);

  return (
    <article>
      <Link
        href="/"
        className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
      >
        ← all activity
      </Link>

      <header className="relative mt-6 pl-6">
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${STRIP_BG[status]}`} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div
              className={`text-xs tracking-widest uppercase ${STATUS_TEXT[status]}`}
              data-status={status}
            >
              {status}
            </div>
            <h2 className="mt-2 font-display text-4xl text-ink leading-tight">
              {run.workflowName}
              {run.isInterrupted && (
                <span className="ml-3 align-middle font-mono text-sm text-ink-muted italic">
                  (deleted)
                </span>
              )}
            </h2>
          </div>
          {status === "running" && onCancel && <CancelButton onCancel={onCancel} />}
        </div>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
          <div className="flex items-baseline">
            <dt className="sr-only">trigger</dt>
            <dd className="tracking-wider lowercase">{run.trigger}</dd>
          </div>
          <span aria-hidden="true" className="text-rule">
            ·
          </span>
          <div className="flex items-baseline">
            <dt className="sr-only">started</dt>
            <dd>
              <time dateTime={run.startedAt} title={run.startedAt}>
                {formatRelativeTime(run.startedAt, now)}
              </time>
            </dd>
          </div>
          <span aria-hidden="true" className="text-rule">
            ·
          </span>
          <div className="flex items-baseline">
            <dt className="sr-only">duration</dt>
            <dd className="text-ink tabular-nums">
              {run.finishedAt ? (
                formatDuration(run.startedAt, run.finishedAt)
              ) : (
                <span className="inline-flex items-baseline gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
                  />
                  in flight
                </span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {run.summary && <RunSummaryBlock summary={run.summary} />}

      {run.error && <RunFailureBlock error={run.error} />}

      <section className="mt-12">
        <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
          <h3 className="text-xs tracking-widest text-ink-muted uppercase">Steps</h3>
          <span className="font-mono text-xs text-ink-muted tabular-nums">
            {regularSteps.length === 1 ? "1 step" : `${regularSteps.length} steps`}
          </span>
        </header>
        {regularSteps.length === 0 ? (
          <p className="font-display text-base text-ink-muted italic">no steps recorded.</p>
        ) : (
          <ol className="divide-y divide-rule">
            {regularSteps.map((step, index) => (
              <li
                key={step.id}
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                className="animate-[feed-row-in_320ms_ease-out_backwards]"
              >
                <StepRow step={step} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {summaryStep && <SummarizerSection step={summaryStep} />}
    </article>
  );
}

function CancelButton({ onCancel }: { onCancel: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setPending(true);
    try {
      await onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="cursor-pointer border border-rule px-3 py-1.5 font-mono text-xs tracking-widest text-ink uppercase no-underline outline-none transition-colors duration-150 hover:border-status-failed hover:text-status-failed focus-visible:border-status-failed focus-visible:text-status-failed focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "cancelling…" : "cancel run"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs font-mono text-xs text-status-failed normal-case">
          {error}
        </p>
      )}
    </div>
  );
}

function RunSummaryBlock({ summary }: { summary: string }) {
  return (
    <section className="mt-10 border-l-2 border-rule py-2 pl-5">
      <h3 className="text-xs tracking-widest text-ink-muted uppercase">Summary</h3>
      <p className="mt-2 text-lg leading-relaxed text-ink">{summary}</p>
    </section>
  );
}

function SummarizerSection({ step }: { step: RunStepRow }) {
  const [open, setOpen] = useState(false);
  const status: StatusKind = step.status;
  const panelId = `summarizer-${step.id}-panel`;

  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Summariser execution</h3>
        <span className={`text-xs tracking-widest uppercase ${STATUS_TEXT[status]}`}>{status}</span>
      </header>
      <div data-status={status} className="group">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="relative flex w-full cursor-pointer items-baseline gap-5 px-5 py-4 text-left no-underline outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        >
          <span
            aria-hidden="true"
            className={`absolute inset-y-2 left-1 w-0.5 transition-all duration-150 group-hover:w-[3px] ${STRIP_BG[status]}`}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
            {stepKindLabel(step)}
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-muted tabular-nums">
            {step.traces ? formatDurationMs(step.traces.durationMs) : "—"}
          </span>
          <span aria-hidden="true" className="shrink-0 font-mono text-xs text-ink-muted">
            {open ? "▴" : "▾"}
          </span>
        </button>
        {open && (
          <div id={panelId} className="space-y-6 px-5 pt-2 pb-6 pl-12">
            <Trace label="stdout" body={step.traces?.stdout ?? ""} />
            <Trace label="stderr" body={step.traces?.stderr ?? ""} />
            {step.error && <StepError error={step.error} />}
            <Materials materials={step.materials} />
          </div>
        )}
      </div>
    </section>
  );
}

function RunFailureBlock({ error }: { error: { message: string; stack?: string } }) {
  const [showStack, setShowStack] = useState(false);
  return (
    <section role="alert" className="mt-10 border-l-2 border-status-failed py-3 pl-5">
      <h3 className="text-xs tracking-widest text-status-failed uppercase">Run failed</h3>
      <pre className="mt-2 font-mono text-sm break-words whitespace-pre-wrap text-ink">
        {error.message}
      </pre>
      {error.stack && (
        <>
          <button
            type="button"
            onClick={() => setShowStack((v) => !v)}
            aria-expanded={showStack}
            className="mt-3 cursor-pointer font-mono text-xs tracking-widest text-ink-muted uppercase no-underline outline-none transition-colors hover:text-accent focus-visible:text-accent"
          >
            {showStack ? "− hide stack" : "+ show stack"}
          </button>
          {showStack && (
            <pre className="mt-2 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
              {error.stack}
            </pre>
          )}
        </>
      )}
    </section>
  );
}

function StepRow({ step }: { step: RunStepRow }) {
  const [open, setOpen] = useState(false);
  const status: StatusKind = step.status;
  const panelId = `step-${step.id}-panel`;
  const stepNumber = String(step.index + 1).padStart(2, "0");

  return (
    <div data-status={status} className="group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="relative flex w-full cursor-pointer items-baseline gap-5 px-5 py-4 text-left no-underline outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-2 left-1 w-0.5 transition-all duration-150 group-hover:w-[3px] ${STRIP_BG[status]}`}
        />
        <span className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">{stepNumber}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
          {stepKindLabel(step)}
        </span>
        <span className={`shrink-0 text-xs tracking-widest uppercase ${STATUS_TEXT[status]}`}>
          {status}
        </span>
        <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-muted tabular-nums">
          {step.traces ? formatDurationMs(step.traces.durationMs) : "—"}
        </span>
        <span aria-hidden="true" className="shrink-0 font-mono text-xs text-ink-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div id={panelId} className="space-y-6 px-5 pt-2 pb-6 pl-12">
          <Trace label="stdout" body={step.traces?.stdout ?? ""} />
          <Trace label="stderr" body={step.traces?.stderr ?? ""} />
          {step.error && <StepError error={step.error} />}
          <Materials materials={step.materials} />
        </div>
      )}
    </div>
  );
}

function Trace({ label, body }: { label: string; body: string }) {
  const isEmpty = body.length === 0;
  return (
    <div>
      <h4 className="text-xs tracking-widest text-ink-muted uppercase">{label}</h4>
      <pre
        className={`mt-2 border-l-2 border-rule py-1 pl-3 font-mono text-xs break-words whitespace-pre-wrap ${isEmpty ? "text-ink-muted italic" : "text-ink"}`}
      >
        {isEmpty ? "(empty)" : body}
      </pre>
    </div>
  );
}

function StepError({ error }: { error: { message: string; stack?: string } }) {
  return (
    <div>
      <h4 className="text-xs tracking-widest text-status-failed uppercase">error</h4>
      <pre className="mt-2 border-l-2 border-status-failed py-1 pl-3 font-mono text-xs break-words whitespace-pre-wrap text-ink">
        {error.message}
      </pre>
      {error.stack && (
        <pre className="mt-2 border-l-2 border-rule py-1 pl-3 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
          {error.stack}
        </pre>
      )}
    </div>
  );
}

function Materials({ materials }: { materials: StepMaterials }) {
  if (materials.kind === "sh") {
    return (
      <div>
        <h4 className="text-xs tracking-widest text-ink-muted uppercase">
          materials — inline shell
        </h4>
        <pre className="mt-2 border-l-2 border-rule py-1 pl-3 font-mono text-xs break-words whitespace-pre-wrap text-ink">
          {materials.source}
        </pre>
      </div>
    );
  }

  const entries = Object.entries(materials.files).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div>
      <h4 className="text-xs tracking-widest text-ink-muted uppercase">
        materials — bundle <span className="text-ink normal-case">{materials.bundle}</span>
      </h4>
      <ul className="mt-2 divide-y divide-rule border-l-2 border-rule pl-3">
        {entries.map(([path, source]) => (
          <BundleFile key={path} path={path} source={source} />
        ))}
      </ul>
    </div>
  );
}

function BundleFile({ path, source }: { path: string; source: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-baseline gap-2 py-1.5 text-left font-mono text-xs text-ink no-underline outline-none transition-colors hover:text-accent focus-visible:text-accent"
      >
        <span aria-hidden="true" className="text-ink-muted">
          {open ? "▾" : "▸"}
        </span>
        <span>{path}</span>
      </button>
      {open && (
        <pre className="mb-2 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
          {source}
        </pre>
      )}
    </li>
  );
}
