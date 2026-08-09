import type { RunListEntry } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import {
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
} from "../../formatters/format-time.ts";
import { ArticleList } from "../activity-feed/article-list.tsx";

/**
 * One run in an activity feed, edged with its status colour. A mono byline
 * tops the entry — an accent `run` kind marker, then status, the relative
 * start time, the duration, and a recommendation count when the run produced
 * any. Every feed row leads with its kind marker whatever the kind, so a mixed
 * feed reads down one column of entity nouns. Below it the row's headline
 * links through to the run, the way a session row's title links to its chat.
 *
 * A run has no name of its own, so `nameBy` picks the fact that titles it
 * here: `workflow` in the blended feed, where the workflow is what you scan
 * for; `time` on a single workflow's page, where every row would otherwise
 * carry the same headline and *when it ran* is what tells two runs apart. The
 * run id titles it in neither — an id addresses a run, it doesn't name one.
 *
 * An optional summary renders below as prose, and the run's articles follow in
 * an indented block, set apart from the row's own links so they read as what
 * the run produced rather than as more of its byline.
 *
 * Runs still in flight have no `finishedAt`, so the duration is omitted — the
 * `running` status word already signals the live state. `now` is injectable so
 * tests render deterministic times; production omits it.
 */
export function RunRow({
  run,
  now,
  nameBy = "time",
}: {
  run: RunListEntry;
  now?: Date;
  nameBy?: "workflow" | "time";
}) {
  return (
    <StatusBlock status={run.status}>
      <Meta>
        <span className="text-accent uppercase">run</span>
        <Status status={run.status} />
        <span>{formatRelativeTime(run.startedAt, now)}</span>
        {run.finishedAt ? (
          <span className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</span>
        ) : null}
        {run.recommendationsCount > 0 ? (
          <span>
            {run.recommendationsCount} recommendation{run.recommendationsCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </Meta>
      {/* Same 16px scale as session rows' headlines so neither kind outweighs
          the other in the blended feed. */}
      <div className="mt-1 text-base">
        <HeadlineLink href={`/runs/${run.id}`}>
          {nameBy === "workflow" ? run.workflowName : formatAbsoluteTime(run.startedAt, now)}
        </HeadlineLink>
      </div>
      {run.summary ? (
        // Mute the whole summary so it reads as secondary to the headline above
        // and the articles below; Markdown inherits the tint rather than
        // pinning its own ink. Markdown's paragraphs render at the 16px reading
        // size — the scale the whole row's content shares.
        <div className="mt-2 text-ink-muted">
          <Markdown content={run.summary} />
        </div>
      ) : null}
      <ArticleList
        articles={run.articles}
        hrefFor={(article) => `/runs/${run.id}/articles/${article.slug}`}
      />
    </StatusBlock>
  );
}
