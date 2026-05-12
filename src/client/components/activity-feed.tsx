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
 * Activity feed: each run is one editorial entry, prefaced by a thin
 * status-coloured strip at the left edge. The entry is a single
 * column laid out as kicker → headline → body → chips:
 *
 *  - A small mono byline (status · trigger · time · duration) sits at
 *    the top as a kicker. The status word is the only colour in the
 *    line, making the row's outcome scannable from the top down.
 *  - The Fraunces workflow name follows as the headline, with a
 *    trailing `→` glyph. The headline is the row's sole click target;
 *    hovering tints its background and slides the arrow toward the
 *    accent gold.
 *  - The optional summary renders below as prose; markdown links
 *    inside it stay independent.
 *  - Artefact chips sit at the foot of the entry as separate links.
 *
 * Runs in flight show a pulsing dot in place of a duration. Rows
 * stagger in on first paint. Empty state is a single italic sentence.
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
              <div data-status={status} className="relative px-5 py-5">
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-1 w-0.5 ${STRIP_BG[status]}`}
                />
                <div className="flex flex-wrap items-center gap-x-2 text-xs leading-none text-ink-muted">
                  <span className={`tracking-wider ${STATUS_TEXT[status]}`}>{status}</span>
                  <span className="text-rule">·</span>
                  <span className="tracking-wider">{run.trigger}</span>
                  <span className="text-rule">·</span>
                  <span>{formatRelativeTime(run.startedAt, now)}</span>
                  <span className="text-rule">·</span>
                  {run.finishedAt ? (
                    <span className="tabular-nums">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-running"
                    />
                  )}
                  {run.isInterrupted && (
                    <>
                      <span className="text-rule">·</span>
                      <span className="italic">deleted</span>
                    </>
                  )}
                </div>
                <Link
                  href={`/runs/${run.id}`}
                  className="group/row-link mt-2 -mx-2 -my-1 inline-flex items-baseline gap-2 rounded-sm px-2 py-1 font-display text-2xl leading-tight text-ink no-underline outline-none transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
                >
                  <span>{run.workflowName}</span>
                  <span
                    aria-hidden="true"
                    className="text-ink-muted transition-all duration-150 group-hover/row-link:translate-x-0.5 group-hover/row-link:text-accent group-focus-visible/row-link:text-accent"
                  >
                    →
                  </span>
                </Link>
                {run.summary && (
                  <div className="kiri-feed-summary mt-3 text-sm leading-snug text-ink [&_p]:mt-1 [&_p]:text-sm [&_p]:leading-snug [&_p]:first:mt-0 [&_ul]:mt-1 [&_ol]:mt-1">
                    <Markdown content={run.summary} />
                  </div>
                )}
                {run.artefacts.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <ArtefactChips runId={run.id} artefacts={run.artefacts} />
                  </div>
                )}
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
  "inline-flex items-baseline gap-1.5 rounded-sm border border-ink-muted bg-paper px-2.5 py-1 font-mono text-xs text-ink normal-case no-underline transition-colors hover:border-accent hover:bg-paper hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

/**
 * Artefact chips for a feed row. Renders one chip per artefact when
 * there are 1–3, collapsing to a single "N artefacts" chip at 4 or
 * more so a chatty workflow doesn't blow the row layout.
 *
 * Returns a fragment rather than a wrapping div — the caller's flex
 * row owns gap and wrapping.
 *
 * Each chip routes to its artefact; the collapsed chip routes to the
 * run page, whose Published section enumerates the full list.
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
