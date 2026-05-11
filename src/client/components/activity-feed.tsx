import type { Ref } from "react";
import { Link } from "wouter";
import type { RunArtefactSummary, RunListEntry } from "../api.ts";
import { formatDuration, formatRelativeTime } from "../formatters/format-time.ts";
import { Markdown } from "./markdown.tsx";

// Beyond this count the chip list collapses to a single "N artefacts"
// chip so a run that publishes a lot of small artefacts doesn't blow
// the row layout. The collapsed chip routes to the run page instead of
// a specific artefact — its Published section lists them all.
const CHIPS_COLLAPSE_AT = 4;

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
 * JetBrains Mono. The whole row is the click target — the row wraps
 * a real `<Link>` on the workflow name plus a `::before` overlay that
 * stretches across the row, so a click anywhere on the row navigates
 * to the run page. Nested interactives inside the row (markdown links
 * in the summary, and chips added later) sit `position: relative` so
 * they punch through the overlay and stay clickable. Rows stagger in
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
              <div
                data-status={status}
                className="group relative flex items-baseline gap-6 px-5 py-5 transition-colors duration-150 hover:bg-paper focus-within:bg-paper focus-within:outline-1 focus-within:outline-accent focus-within:-outline-offset-1"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-1 w-0.5 transition-all duration-150 group-hover:w-[3px] group-focus-within:w-[3px] ${STRIP_BG[status]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-2xl text-ink leading-tight">
                    <Link
                      href={`/runs/${run.id}`}
                      className="text-ink no-underline outline-none before:absolute before:inset-0 before:content-['']"
                    >
                      {run.workflowName}
                    </Link>
                    {run.isInterrupted && (
                      <span className="ml-2 align-middle font-mono text-xs text-ink-muted italic">
                        (deleted)
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs leading-none text-ink-muted">
                    <span className={`tracking-widest uppercase ${STATUS_TEXT[status]}`}>
                      {status}
                    </span>
                    <span className="text-rule">·</span>
                    <span className="tracking-wider lowercase">{run.trigger}</span>
                  </div>
                  {run.summary && (
                    <div className="kiri-feed-summary relative mt-2 text-sm leading-snug text-ink [&_p]:mt-1 [&_p]:text-sm [&_p]:leading-snug [&_p]:first:mt-0 [&_ul]:mt-1 [&_ol]:mt-1">
                      <Markdown content={run.summary} />
                    </div>
                  )}
                  {run.artefacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ArtefactChips runId={run.id} artefacts={run.artefacts} />
                    </div>
                  )}
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
              </div>
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

const CHIP_CLASSES =
  "relative inline-flex items-baseline gap-1.5 rounded-sm border border-ink-muted bg-paper px-2.5 py-1 font-mono text-xs text-ink normal-case no-underline transition-colors hover:border-accent hover:bg-paper hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

/**
 * Artefact chips for a feed row. Renders one chip per artefact when
 * there are 1–3, collapsing to a single "📄 N artefacts" chip at 4 or
 * more so a chatty workflow doesn't blow the row layout.
 *
 * Designed to sit inline within the row's metadata flex row (next to
 * status and trigger), so it returns a fragment rather than a wrapping
 * div — the parent owns gap and wrapping.
 *
 * Chips are `position: relative` so they paint above the row's
 * stacked-link overlay and stay individually navigable — clicking a
 * chip routes to its artefact rather than the run page. The collapsed
 * chip routes to the run page, whose Published section enumerates the
 * full list.
 */
function ArtefactChips({
  runId,
  artefacts,
}: {
  runId: string;
  artefacts: RunArtefactSummary[];
}) {
  if (artefacts.length >= CHIPS_COLLAPSE_AT) {
    return (
      <Link href={`/runs/${runId}`} className={CHIP_CLASSES}>
        {artefacts.length} artefacts
      </Link>
    );
  }
  return (
    <>
      {artefacts.map((artefact) => (
        <Link
          key={artefact.name}
          href={`/runs/${runId}/published/${artefact.name}`}
          className={CHIP_CLASSES}
        >
          {artefact.title}
        </Link>
      ))}
    </>
  );
}
