import { useEffect, useState } from "react";
import { type RunListEntry, fetchRunsPage } from "../api.ts";
import { formatDurationMs } from "../formatters/format-time.ts";
import { EmptyState } from "./ui/empty-state.tsx";
import { LoadingState } from "./ui/loading-state.tsx";

/** How many recent runs the panel snapshots. */
const WINDOW = 14;

/** Shortest bar height (fraction of the track) so a near-zero run still shows. */
const MIN_BAR = 0.12;

/** Visual tone of a sparkline bar: healthy, slower-than-median, or failed. */
type Tone = "ok" | "warm" | "failed";

const TONE_BG: Record<Tone, string> = {
  ok: "bg-status-ok",
  warm: "bg-accent-warm",
  failed: "bg-status-failed",
};

const durationMs = (run: RunListEntry): number =>
  run.finishedAt === null
    ? 0
    : Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const toneOf = (run: RunListEntry, runMs: number, medianMs: number): Tone => {
  if (run.status === "failed") return "failed";
  return runMs > medianMs ? "warm" : "ok";
};

/**
 * At-a-glance health panel for one workflow, sitting between the hero and
 * the tab strip. Snapshots the workflow's most recent runs (a single
 * fetch on mount — no live updates) and renders a horizontal stat row
 * (runs / ok / failed / articles / avg duration) above a duration
 * sparkline, one bar per run oldest → newest. Bar height scales to each
 * run's duration relative to the window max; bars slower than the window
 * median tint warm and failed runs tint red.
 */
export function WorkflowStats({ workflowName }: { workflowName: string }) {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRunsPage({ workflow: workflowName, limit: WINDOW })
      .then((page) => {
        if (!cancelled) setRuns(page.runs);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowName]);

  return (
    <section aria-labelledby="workflow-stats-heading" className="mt-6 border border-rule p-5">
      <h3
        id="workflow-stats-heading"
        className="mb-4 font-mono text-xs text-ink-muted uppercase tracking-[0.22em]"
      >
        Last {WINDOW} runs
      </h3>
      <StatsBody runs={runs} error={error} />
    </section>
  );
}

function StatsBody({ runs, error }: { runs: RunListEntry[] | null; error: Error | null }) {
  if (error) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load run stats: {error.message}
      </p>
    );
  }
  if (runs === null) return <LoadingState>Loading run stats…</LoadingState>;
  if (runs.length === 0) return <EmptyState>no runs to chart yet.</EmptyState>;

  const okCount = runs.filter((run) => run.status === "ok").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const articleCount = runs.reduce((sum, run) => sum + run.articles.length, 0);
  const durations = runs.map(durationMs);
  const avgMs = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;

  return (
    <div className="flex flex-wrap items-end gap-x-9 gap-y-6">
      <dl className="flex flex-wrap gap-x-7 gap-y-4">
        <Stat label="runs" value={String(runs.length)} />
        <Stat label="ok" value={String(okCount)} className="text-status-ok" />
        <Stat
          label="failed"
          value={String(failedCount)}
          className={failedCount > 0 ? "text-status-failed" : undefined}
        />
        <Stat label="articles" value={String(articleCount)} />
        <Stat label="avg duration" value={formatDurationMs(avgMs)} />
      </dl>
      <Sparkline runs={runs} durations={durations} />
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-xs text-ink-muted uppercase tracking-[0.18em]">{label}</dt>
      <dd
        className={`font-display text-2xl leading-none tabular-nums${className ? ` ${className}` : " text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Sparkline({ runs, durations }: { runs: RunListEntry[]; durations: number[] }) {
  const maxMs = Math.max(...durations);
  const medianMs = median(durations);

  return (
    <div className="min-w-[220px] flex-1">
      <div aria-label="Run durations, oldest to newest" className="flex h-11 items-end gap-[3px]">
        {runs
          .map((run, index) => ({ run, ms: durations[index] }))
          .reverse()
          .map(({ run, ms }) => {
            const tone = toneOf(run, ms, medianMs);
            const heightPct = (maxMs > 0 ? Math.max(MIN_BAR, ms / maxMs) : MIN_BAR) * 100;
            return (
              <span
                key={run.id}
                aria-hidden="true"
                data-tone={tone}
                title={run.finishedAt === null ? "in progress" : formatDurationMs(ms)}
                className={`flex-1 ${TONE_BG[tone]}`}
                style={{ height: `${heightPct.toFixed(1)}%` }}
              />
            );
          })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs text-ink-faint">
        <span>oldest</span>
        <span>duration · now</span>
      </div>
    </div>
  );
}
