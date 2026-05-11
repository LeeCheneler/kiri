import type { Ref } from "react";
import { Link } from "wouter";
import type { RunListEntry } from "../api.ts";
import { formatDuration, formatRelativeTime } from "../formatters/format-time.ts";

type RunStatusKind = "running" | "ok" | "failed" | "cancelled" | "interrupted";

const STRIP_BG: Record<RunStatusKind, string> = {
  running: "bg-status-running",
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
  interrupted: "bg-status-interrupted",
};

const STATUS_TEXT: Record<RunStatusKind, string> = {
  running: "text-status-running",
  ok: "text-status-ok",
  failed: "text-status-failed",
  cancelled: "text-status-cancelled",
  interrupted: "text-status-interrupted",
};

const statusFor = (run: RunListEntry): RunStatusKind => run.status;

/**
 * Activity feed: each run is one editorial row prefaced by a status
 * strip, with the workflow name set in Fraunces and the metadata in
 * JetBrains Mono. The whole row is the click target. Rows stagger in
 * on first paint; the running indicator pulses softly. Empty state is
 * a single italic sentence.
 *
 * `sentinelRef` marks the bottom of the list so an
 * `IntersectionObserver` can trigger the next page load. `isLoadingMore`
 * shows a soft loading strip beneath the list while a page is in
 * flight; `endReached` swaps that for an end-of-feed indicator once
 * `nextCursor` is null.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ActivityFeed({
  runs,
  now,
  sentinelRef,
  isLoadingMore = false,
  endReached = false,
}: {
  runs: RunListEntry[];
  now?: Date;
  sentinelRef?: Ref<HTMLDivElement>;
  isLoadingMore?: boolean;
  endReached?: boolean;
}) {
  if (runs.length === 0) {
    return <p className="font-display text-base text-ink-muted italic">no runs yet.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-rule">
        {runs.map((run, index) => {
          const status = statusFor(run);
          return (
            <li
              key={run.id}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              className="animate-[feed-row-in_320ms_ease-out_backwards]"
            >
              <Link
                href={`/runs/${run.id}`}
                data-status={status}
                className="group relative flex items-baseline gap-6 px-5 py-5 no-underline outline-none transition-colors duration-150 hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-1 w-0.5 transition-all duration-150 group-hover:w-[3px] group-focus-visible:w-[3px] ${STRIP_BG[status]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-2xl text-ink leading-tight">
                    {run.workflowName}
                    {run.isInterrupted && (
                      <span className="ml-2 align-middle font-mono text-xs text-ink-muted italic">
                        (deleted)
                      </span>
                    )}
                  </div>
                  {run.summary && (
                    <p className="mt-2 line-clamp-2 text-sm leading-snug text-ink">{run.summary}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs leading-none text-ink-muted">
                    <span className={`tracking-widest uppercase ${STATUS_TEXT[status]}`}>
                      {status}
                    </span>
                    <span className="text-rule">·</span>
                    <span className="tracking-wider lowercase">{run.trigger}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right leading-tight tabular-nums">
                  <div className="text-xs text-ink-muted">
                    {formatRelativeTime(run.startedAt, now)}
                  </div>
                  <div className="mt-1.5 text-sm text-ink">
                    {run.finishedAt ? (
                      formatDuration(run.startedAt, run.finishedAt)
                    ) : (
                      <span
                        aria-hidden="true"
                        className="ml-auto inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-running"
                      />
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {endReached ? (
        <output className="block px-5 py-6 text-center font-mono text-xs tracking-widest text-ink-muted uppercase">
          end of feed
        </output>
      ) : (
        <div ref={sentinelRef} className="px-5 py-6 text-center">
          {isLoadingMore && (
            <output className="font-mono text-xs tracking-widest text-ink-muted uppercase">
              loading more…
            </output>
          )}
        </div>
      )}
    </>
  );
}
