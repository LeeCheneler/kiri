import { useState } from "react";
import { Link } from "wouter";
import { resolvePublishTitle } from "../../shared/publish-title.ts";
import type {
  RunArtefactSummary,
  RunDetail,
  RunListEntry,
  RunStepRow,
  WorkflowStepSummary,
} from "../api.ts";
import { formatDuration, formatDurationMs, formatRelativeTime } from "../formatters/format-time.ts";
import { Markdown } from "./markdown.tsx";

type StatusKind = "pending" | "running" | "ok" | "failed" | "cancelled" | "interrupted";

const STRIP_BG: Record<StatusKind, string> = {
  pending: "bg-status-pending",
  running: "bg-status-running",
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
  interrupted: "bg-status-interrupted",
};

const STATUS_TEXT: Record<StatusKind, string> = {
  pending: "text-status-pending",
  running: "text-status-running",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};

const SHELL_PREVIEW_LIMIT = 60;

const runStatus = (run: RunListEntry): StatusKind => run.status;

// Activity-list item kinds; every row carries one so the unified list
// still tells you which phase of the run produced each entry.
type ActivityKind = "step" | "publishing" | "summarising";

const KIND_LABEL: Record<ActivityKind, string> = {
  step: "step",
  publishing: "publishing",
  summarising: "summarising",
};

const declaredStepLabel = (declared: WorkflowStepSummary): string => {
  if ("use" in declared) return `use: ${declared.use}`;
  const firstLine = declared.sh.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  return `sh: ${trimmed.length > SHELL_PREVIEW_LIMIT ? `${trimmed.slice(0, SHELL_PREVIEW_LIMIT)}…` : trimmed}`;
};

interface ActivityItem {
  key: string;
  ordinal: number;
  kind: ActivityKind;
  title: string;
  status: StatusKind;
  /** The persisted step row, when the runner has reached this item. */
  row: RunStepRow | undefined;
}

/**
 * Synthesise the run's activity list from the snapshotted definition
 * plus any persisted step rows. Activities declared but not yet
 * reached by the runner appear as `pending`; rows present surface
 * their actual status. Ordering matches execution order: pipeline
 * steps → publishes → summariser.
 */
const buildActivityItems = (run: RunListEntry, steps: RunStepRow[]): ActivityItem[] => {
  const rowByIndex = new Map<number, RunStepRow>();
  for (const row of steps) rowByIndex.set(row.index, row);

  const snap = run.definitionSnapshot;
  const items: ActivityItem[] = [];

  for (let i = 0; i < snap.steps.length; i++) {
    const row = rowByIndex.get(i);
    items.push({
      key: row?.id ?? `step-${i}`,
      ordinal: items.length + 1,
      kind: "step",
      title: declaredStepLabel(snap.steps[i]),
      status: row?.status ?? "pending",
      row,
    });
  }

  const publishes = snap.publish ?? [];
  for (let pi = 0; pi < publishes.length; pi++) {
    const index = snap.steps.length + pi;
    const row = rowByIndex.get(index);
    const entry = publishes[pi];
    items.push({
      key: row?.id ?? `publish-${pi}`,
      ordinal: items.length + 1,
      kind: "publishing",
      title: resolvePublishTitle(entry.name, entry.title),
      status: row?.status ?? "pending",
      row,
    });
  }

  if (snap.summarize) {
    const index = snap.steps.length + publishes.length;
    const row = rowByIndex.get(index);
    items.push({
      key: row?.id ?? "summarise",
      ordinal: items.length + 1,
      kind: "summarising",
      title: declaredStepLabel(snap.summarize),
      status: row?.status ?? "pending",
      row,
    });
  }

  return items;
};

/**
 * Editorial detail view for a single run. The header promotes the feed
 * entry to page-header scale: a thicker status-coloured strip on the
 * left, a mono byline (status · trigger · time · duration · git ref)
 * as a kicker, and the workflow name in Fraunces beneath. Run-level
 * controls (cancel / re-run / delete) sit on the headline row. Run-
 * level failures render above the activity list so they're not buried
 * in a disclosure.
 *
 * Everything the run intends to do — pipeline steps, publishes, the
 * summariser — appears as one ordered activity list. Declared
 * activities show as pending until the runner reaches them; running
 * rows pulse; terminal rows expose their envelope via disclosure.
 * One list keeps the visual language consistent across phases of the
 * run.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 *
 * `onCancel`, when supplied, surfaces a cancel button in the header
 * while the run is `running`. The handler resolves on accepted-cancel
 * (HTTP 202) and rejects with the server error otherwise — the button
 * shows a brief inline message in the rejected case.
 *
 * `onDelete`, when supplied, surfaces a delete button in the header
 * for any non-running run (mutually exclusive with cancel). The
 * handler resolves once the run is gone and rejects with the server
 * error otherwise — the button shows a brief inline message in the
 * rejected case.
 *
 * `onRerun`, when supplied, surfaces a "run again" button in the header
 * alongside delete for any non-running run. Disabled with a tooltip
 * when the run is interrupted (workflow no longer in the registry).
 * The handler resolves once the run flips back to `running` and rejects
 * with the server error otherwise.
 */
export function RunDetailView({
  detail,
  now,
  onCancel,
  onDelete,
  onRerun,
}: {
  detail: RunDetail;
  now?: Date;
  onCancel?: () => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onRerun?: () => Promise<unknown>;
}) {
  const { run, steps } = detail;
  const { artefacts } = run;
  const status = runStatus(run);
  const activity = buildActivityItems(run, steps);

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
        <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-none text-ink-muted">
          <div className="flex items-baseline">
            <dt className="sr-only">status</dt>
            <dd className={`tracking-wider ${STATUS_TEXT[status]}`} data-status={status}>
              {status}
            </dd>
          </div>
          <span aria-hidden="true" className="text-rule">
            ·
          </span>
          <div className="flex items-baseline">
            <dt className="sr-only">trigger</dt>
            <dd className="tracking-wider">{run.trigger}</dd>
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
            <dd className="tabular-nums">
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
          {run.gitSha && (
            <>
              <span aria-hidden="true" className="text-rule">
                ·
              </span>
              <div className="flex items-baseline gap-1.5">
                <dt className="sr-only">git ref</dt>
                <dd className="tabular-nums" title={run.gitSha}>
                  {run.gitSha.slice(0, 7)}
                </dd>
                {run.gitDirty && <span className="italic">(dirty)</span>}
              </div>
            </>
          )}
          {run.isInterrupted && (
            <>
              <span aria-hidden="true" className="text-rule">
                ·
              </span>
              <span className="italic">deleted</span>
            </>
          )}
        </dl>
        <div className="mt-3 flex items-start justify-between gap-4">
          <h2 className="min-w-0 flex-1 font-display text-4xl text-ink leading-tight">
            {run.workflowName}
          </h2>
          {status === "running" ? (
            onCancel && <CancelButton onCancel={onCancel} />
          ) : (
            <div className="flex shrink-0 items-start gap-2">
              {onRerun && <RerunButton onRerun={onRerun} interrupted={run.isInterrupted} />}
              {onDelete && <DeleteButton onDelete={onDelete} />}
            </div>
          )}
        </div>
      </header>

      {run.summary && <RunSummaryBlock summary={run.summary} />}

      {artefacts.length > 0 && <PublishedSection runId={run.id} artefacts={artefacts} now={now} />}

      {run.error && <RunFailureBlock error={run.error} />}

      <ActivitySection items={activity} />
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

function RerunButton({
  onRerun,
  interrupted,
}: {
  onRerun: () => Promise<unknown>;
  interrupted: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (interrupted) return;
    setError(null);
    setPending(true);
    try {
      await onRerun();
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
        disabled={pending || interrupted}
        title={interrupted ? "the workflow no longer exists; re-create it first" : undefined}
        className="cursor-pointer border border-rule px-3 py-1.5 font-mono text-xs tracking-widest text-ink uppercase no-underline outline-none transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "starting…" : "run again"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs font-mono text-xs text-status-failed normal-case">
          {error}
        </p>
      )}
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setPending(true);
    try {
      await onDelete();
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
        {pending ? "deleting…" : "delete"}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs font-mono text-xs text-status-failed normal-case">
          {error}
        </p>
      )}
    </div>
  );
}

function ActivitySection({ items }: { items: ActivityItem[] }) {
  const headingId = "activity-heading";
  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 id={headingId} className="text-xs tracking-widest text-ink-muted uppercase">
          Activity
        </h3>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {items.length === 1 ? "1 item" : `${items.length} items`}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="font-display text-base text-ink-muted italic">no activity recorded.</p>
      ) : (
        <ol aria-labelledby={headingId} className="divide-y divide-rule">
          {items.map((item, index) => (
            <li
              key={item.key}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              className="animate-[feed-row-in_320ms_ease-out_backwards]"
            >
              <ActivityRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { row, status, kind, title, ordinal } = item;
  const [open, setOpen] = useState(false);
  const ordinalText = String(ordinal).padStart(2, "0");
  const isPending = status === "pending";
  const titleClass = isPending ? "text-status-pending" : "text-ink";
  const metaClass = isPending ? "text-status-pending" : "text-ink-muted";
  const panelId = row ? `activity-${row.id}-panel` : undefined;

  const rowContent = (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-1 w-0.5 ${row ? "transition-all duration-150 group-hover:w-[3px] " : ""}${STRIP_BG[status]}`}
      />
      <span className={`shrink-0 font-mono text-xs tabular-nums ${metaClass}`}>{ordinalText}</span>
      <span
        className={`w-20 shrink-0 font-mono text-[10px] tracking-widest uppercase ${metaClass}`}
      >
        {KIND_LABEL[kind]}
      </span>
      <span className={`min-w-0 flex-1 truncate font-mono text-sm ${titleClass}`}>{title}</span>
      <span className={`shrink-0 text-xs tracking-widest uppercase ${STATUS_TEXT[status]}`}>
        {status === "running" ? (
          <span className="inline-flex items-baseline gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
            />
            running
          </span>
        ) : (
          status
        )}
      </span>
      <span className={`w-16 shrink-0 text-right font-mono text-xs tabular-nums ${metaClass}`}>
        {row?.traces ? formatDurationMs(row.traces.durationMs) : "—"}
      </span>
      <span aria-hidden="true" className={`w-3 shrink-0 font-mono text-xs ${metaClass}`}>
        {row ? (open ? "▴" : "▾") : ""}
      </span>
    </>
  );

  return (
    <div data-status={status} data-kind={kind} className="group">
      {row ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="relative flex w-full cursor-pointer items-baseline gap-5 px-5 py-4 text-left no-underline outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        >
          {rowContent}
        </button>
      ) : (
        <div className="relative flex items-baseline gap-5 px-5 py-4">{rowContent}</div>
      )}
      {open && row && (
        <div id={panelId} className="space-y-6 px-5 pt-2 pb-6 pl-12">
          <Trace label="stdout" body={row.traces?.stdout ?? ""} />
          <Trace label="stderr" body={row.traces?.stderr ?? ""} />
          {row.error && <StepError error={row.error} />}
        </div>
      )}
    </div>
  );
}

function PublishedSection({
  runId,
  artefacts,
  now,
}: {
  runId: string;
  artefacts: RunArtefactSummary[];
  now?: Date;
}) {
  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Published</h3>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {artefacts.length === 1 ? "1 artefact" : `${artefacts.length} artefacts`}
        </span>
      </header>
      <ul className="space-y-2">
        {artefacts.map((artefact) => (
          <li key={artefact.name}>
            <Link
              href={`/runs/${runId}/published/${artefact.name}`}
              className="group flex items-center gap-4 border border-ink-muted bg-paper px-5 py-4 no-underline outline-none transition-colors duration-150 hover:border-accent focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
            >
              <span className="min-w-0 flex-1 truncate font-display text-lg text-ink transition-colors group-hover:text-accent group-focus-visible:text-accent">
                {artefact.title}
              </span>
              <time
                dateTime={artefact.createdAt}
                title={artefact.createdAt}
                className="shrink-0 font-mono text-xs text-ink-muted tabular-nums"
              >
                {formatRelativeTime(artefact.createdAt, now)}
              </time>
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-sm text-ink-muted transition-colors group-hover:text-accent group-focus-visible:text-accent"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunSummaryBlock({ summary }: { summary: string }) {
  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Summary</h3>
      </header>
      <div className="text-ink [&_p]:mt-2 [&_p]:text-sm [&_p]:leading-snug [&_p]:first:mt-0 [&_ul]:mt-2 [&_ol]:mt-2 [&_li]:text-sm">
        <Markdown content={summary} />
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
