import type { ReactNode } from "react";
import type { RunDetailRun } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatDuration, formatRelativeTime } from "../../formatters/format-time.ts";
import { LiveDuration } from "./live-duration.tsx";

/**
 * The run detail header: an accent eyebrow naming the producing workflow, the
 * run's short id as the page heading — set in mono, since a run id is a
 * machine-layer identifier rather than prose — and a byline of run facts:
 * status, when it started, how long it ran (a live elapsed timer while in
 * flight, the final span once it has a finish time), and a "deleted" marker
 * when the workflow is no longer in the registry.
 *
 * `actions` renders beside the heading — the run-level controls (cancel while
 * running; re-run and delete once terminal). `now` is injectable so tests
 * render deterministic times and the live timer doesn't tick; production omits
 * it.
 */
export function RunHeader({
  run,
  now,
  actions,
}: {
  run: RunDetailRun;
  now?: Date;
  actions?: ReactNode;
}) {
  return (
    <header className="mt-6 border-rule border-b pb-6">
      <Eyebrow>{run.workflowName} · Run</Eyebrow>
      <div className="mt-2 flex items-start justify-between gap-4">
        <h2 title={run.id} className="min-w-0 font-mono text-5xl text-ink leading-none">
          {run.id.slice(0, 8)}
        </h2>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-5">
        <Meta>
          <Status status={run.status} />
          <time dateTime={run.startedAt} title={run.startedAt}>
            {formatRelativeTime(run.startedAt, now)}
          </time>
          {run.finishedAt ? (
            <span className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</span>
          ) : (
            <LiveDuration startedAt={run.startedAt} now={now} />
          )}
          {run.isInterrupted ? <span className="italic">deleted</span> : null}
        </Meta>
      </div>
    </header>
  );
}
