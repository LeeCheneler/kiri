import type { UseQueryResult } from "@tanstack/react-query";
import type { RunListEntry } from "../../api.ts";
import { Sparkline, type SparklineBar } from "../../design-system/charts/sparkline.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Stat, StatList } from "../../design-system/content/stat.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { formatDurationMs } from "../../formatters/format-time.ts";
import { useWorkflowRunWindow } from "../../state/runs.ts";

/** How many recent runs the panel snapshots. */
const WINDOW = 14;

const durationMs = (run: RunListEntry): number =>
  run.finishedAt === null
    ? 0
    : Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

// A run's bar tone: failed runs read red, runs slower than the window median
// tint warm as a "watch this" cue, the rest are healthy green.
const toneOf = (run: RunListEntry, runMs: number, medianMs: number): SparklineBar["tone"] => {
  if (run.status === "failed") return "failed";
  return runMs > medianMs ? "warm" : "ok";
};

/**
 * At-a-glance health panel for one workflow. Reads the live run window and
 * renders a stat row (runs / ok / failed / articles / avg duration) above a
 * duration sparkline, one bar per run oldest → newest. Stays current with the
 * window query, so completing runs recount without a reload.
 */
export function WorkflowStats({ workflowName }: { workflowName: string }) {
  const window = useWorkflowRunWindow(workflowName, WINDOW);
  return (
    <Card>
      <h3 className="mb-5 font-mono text-xs tracking-widest text-ink-muted uppercase">
        Last {WINDOW} runs
      </h3>
      <StatsBody window={window} />
    </Card>
  );
}

function StatsBody({ window }: { window: UseQueryResult<RunListEntry[]> }) {
  if (window.isPending) {
    return <p className="font-mono text-sm text-ink-muted">Loading run stats…</p>;
  }
  if (window.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load run stats: {window.error.message}
      </p>
    );
  }
  const runs = window.data;
  if (runs.length === 0) {
    return <EmptyState>no runs to chart yet.</EmptyState>;
  }

  const okCount = runs.filter((run) => run.status === "ok").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const articleCount = runs.reduce((sum, run) => sum + run.articles.length, 0);
  const durations = runs.map(durationMs);
  const avgMs = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
  const medianMs = median(durations);

  // The window arrives newest-first; the sparkline reads oldest → newest.
  const bars: SparklineBar[] = runs
    .map((run, index) => ({
      value: durations[index],
      tone: toneOf(run, durations[index], medianMs),
      label: run.finishedAt === null ? "in progress" : formatDurationMs(durations[index]),
    }))
    .reverse();

  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
      <StatList>
        <Stat label="runs">{runs.length}</Stat>
        <Stat label="ok" tone="ok">
          {okCount}
        </Stat>
        <Stat label="failed" tone={failedCount > 0 ? "failed" : "default"}>
          {failedCount}
        </Stat>
        <Stat label="articles">{articleCount}</Stat>
        <Stat label="avg duration">{formatDurationMs(avgMs)}</Stat>
      </StatList>
      <div className="min-w-[220px] flex-1">
        <Sparkline
          bars={bars}
          label="Run durations, oldest to newest"
          startLabel="oldest"
          endLabel="duration · now"
        />
      </div>
    </div>
  );
}
