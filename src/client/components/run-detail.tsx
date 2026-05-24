import { useState } from "react";
import { Link } from "wouter";
import { resolvePublishTitle } from "../../shared/publish-title.ts";
import type {
  ArticleSummary,
  RunDetail,
  RunListEntry,
  RunStepRow,
  WorkflowInputSummary,
  WorkflowStepSummary,
} from "../api.ts";
import { formatDuration, formatDurationMs, formatRelativeTime } from "../formatters/format-time.ts";
import { InvokeModal } from "./invoke-modal.tsx";
import { Markdown } from "./markdown.tsx";
import { Actions } from "./ui/actions.tsx";
import { Button } from "./ui/button.tsx";
import { PulseDot } from "./ui/pulse-dot.tsx";
import { StatusLabel } from "./ui/status-label.tsx";
import { StatusStrip } from "./ui/status-strip.tsx";
import type { StatusKind } from "./ui/status-style.ts";

const SHELL_PREVIEW_LIMIT = 60;

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
 * When the run was invoked with inputs, the resolved snapshot renders
 * as an Inputs section directly under the header — name/value pairs in
 * a `<dl>` so values stay plain text. Hidden entirely when the run
 * carried no inputs.
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
 *
 * `workflowInputs`, when supplied with at least one entry, switches the
 * re-run path through the `InvokeModal` pre-filled from the prior run's
 * snapshotted `run.inputs` (falling back to each input's declared
 * `default` for newly added entries; entries no longer declared are
 * silently dropped). `onRerun` then receives the (possibly tweaked)
 * values map. Workflows without declared inputs keep today's bare
 * confirm-then-fire path.
 */
export function RunDetailView({
  detail,
  now,
  onCancel,
  onDelete,
  onRerun,
  workflowInputs,
}: {
  detail: RunDetail;
  now?: Date;
  onCancel?: () => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onRerun?: (inputs?: Record<string, string>) => Promise<unknown>;
  workflowInputs?: WorkflowInputSummary[];
}) {
  const { run, steps } = detail;
  const { articles } = run;
  const status: StatusKind = run.status;
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
        <StatusStrip status={status} />
        <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-none text-ink-muted">
          <div className="flex items-baseline">
            <dt className="sr-only">status</dt>
            <dd className="tracking-wider">
              <StatusLabel status={status} />
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
                  <PulseDot />
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
          {status === "running"
            ? onCancel && <CancelButton onCancel={onCancel} />
            : (onRerun || onDelete) && (
                <TerminalActions
                  onRerun={onRerun}
                  onDelete={onDelete}
                  interrupted={run.isInterrupted}
                  workflowName={run.workflowName}
                  workflowInputs={workflowInputs}
                  priorInputs={run.inputs}
                />
              )}
        </div>
      </header>

      {run.inputs && Object.keys(run.inputs).length > 0 && <InputsSection inputs={run.inputs} />}

      {run.summary && <RunSummaryBlock summary={run.summary} />}

      {articles.length > 0 && <PublishedSection runId={run.id} articles={articles} now={now} />}

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
    <Actions errorMessage={error}>
      <Button variant="danger" pending={pending} pendingLabel="cancelling…" onClick={handleClick}>
        cancel run
      </Button>
    </Actions>
  );
}

function TerminalActions({
  onRerun,
  onDelete,
  interrupted,
  workflowName,
  workflowInputs,
  priorInputs,
}: {
  onRerun?: (inputs?: Record<string, string>) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  interrupted: boolean;
  workflowName: string;
  workflowInputs?: WorkflowInputSummary[];
  priorInputs: Record<string, string> | null;
}) {
  const [rerunPending, setRerunPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const hasInputs = (workflowInputs?.length ?? 0) > 0;

  const handleRerun = async () => {
    if (!onRerun || interrupted) return;
    if (hasInputs) {
      // Modal is the confirmation gesture for the inputs path — user has
      // to fill the form and click submit. No window.confirm gate here.
      setError(null);
      setModalOpen(true);
      return;
    }
    setError(null);
    setRerunPending(true);
    try {
      await onRerun();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRerunPending(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setError(null);
    setDeletePending(true);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletePending(false);
    }
  };

  const handleModalSubmit = async (values: Record<string, string>) => {
    if (!onRerun) return;
    // Successful rerun closes the dialog; a rejection propagates to the
    // modal's inline error UI so the user can retry without losing values.
    await onRerun(values);
    setModalOpen(false);
  };

  return (
    <>
      <Actions errorMessage={error}>
        {onRerun && (
          <Button
            pending={rerunPending}
            pendingLabel="starting…"
            disabled={interrupted}
            title={interrupted ? "the workflow no longer exists; re-create it first" : undefined}
            onClick={handleRerun}
          >
            run again
          </Button>
        )}
        {onDelete && (
          <Button
            variant="danger"
            pending={deletePending}
            pendingLabel="deleting…"
            onClick={handleDelete}
          >
            delete
          </Button>
        )}
      </Actions>
      {modalOpen && workflowInputs && (
        <InvokeModal
          workflowName={workflowName}
          inputs={workflowInputs}
          initialValues={priorInputs ?? undefined}
          notice="The previous attempt's steps and traces will be cleared."
          onSubmit={handleModalSubmit}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </>
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
      <StatusStrip status={status} hoverGrow={!!row} />
      <span className={`shrink-0 font-mono text-xs tabular-nums ${metaClass}`}>{ordinalText}</span>
      <span
        className={`w-20 shrink-0 font-mono text-[10px] tracking-widest uppercase ${metaClass}`}
      >
        {KIND_LABEL[kind]}
      </span>
      <span className={`min-w-0 flex-1 truncate font-mono text-sm ${titleClass}`}>{title}</span>
      <span className="shrink-0 text-xs tracking-widest uppercase">
        <StatusLabel status={status} />
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
  articles,
  now,
}: {
  runId: string;
  articles: ArticleSummary[];
  now?: Date;
}) {
  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Published</h3>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {articles.length === 1 ? "1 article" : `${articles.length} articles`}
        </span>
      </header>
      <ul className="space-y-2">
        {articles.map((article) => (
          <li key={article.name}>
            <Link
              href={`/runs/${runId}/published/${article.name}`}
              className="group flex items-center gap-4 border border-ink-muted bg-paper px-5 py-4 no-underline outline-none transition-colors duration-150 hover:border-accent focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
            >
              <span className="min-w-0 flex-1 truncate font-display text-lg text-ink transition-colors group-hover:text-accent group-focus-visible:text-accent">
                {article.title}
              </span>
              <time
                dateTime={article.createdAt}
                title={article.createdAt}
                className="shrink-0 font-mono text-xs text-ink-muted tabular-nums"
              >
                {formatRelativeTime(article.createdAt, now)}
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

function InputsSection({ inputs }: { inputs: Record<string, string> }) {
  const entries = Object.entries(inputs);
  return (
    <section className="mt-12">
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Inputs</h3>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {entries.length === 1 ? "1 input" : `${entries.length} inputs`}
        </span>
      </header>
      <dl className="divide-y divide-rule">
        {entries.map(([name, value]) => (
          <div key={name} className="flex items-baseline gap-5 px-5 py-3">
            <dt className="w-40 shrink-0 font-mono text-xs text-ink-muted">{name}</dt>
            <dd className="min-w-0 flex-1 font-mono text-sm break-words whitespace-pre-wrap text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>
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
