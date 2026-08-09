import type { RunListEntry } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatDuration, formatRelativeTime } from "../../formatters/format-time.ts";

/**
 * One run in an activity feed, edged with its status colour. A mono byline
 * tops the entry — an accent `run` kind marker, then status, the short run id
 * (which carries the link through to the run detail), the relative start time,
 * the duration, and a recommendation count when the run produced any. Every
 * feed row leads with its kind marker whatever the kind, so a mixed feed reads
 * down one column of entity nouns. `showWorkflow` surfaces the run's workflow
 * as the byline's lead link (to the workflow page); it defaults off for the
 * single-workflow feed, where the name would repeat on every row, and is set
 * for the cross-workflow home feed. An optional summary
 * renders below as prose, and the run's articles follow as a stacked list of
 * links, each carrying the article's first heading (falling back to its name).
 * With no summary, those articles are the row's visual lead.
 *
 * Runs still in flight have no `finishedAt`, so the duration is omitted — the
 * `running` status word already signals the live state. `now` is injectable so
 * tests render deterministic relative times; production omits it.
 */
export function RunRow({
  run,
  now,
  showWorkflow,
}: {
  run: RunListEntry;
  now?: Date;
  showWorkflow?: boolean;
}) {
  return (
    <StatusBlock status={run.status}>
      <Meta>
        <span className="text-accent uppercase">run</span>
        <Status status={run.status} />
        {/* Each link is wrapped in a span so Meta's middot separator attaches to
            the span, not the anchor — on the anchor it joins the link's underline
            and hit area. */}
        {showWorkflow ? (
          <span>
            <InlineLink href={`/workflows/${encodeURIComponent(run.workflowName)}`}>
              {run.workflowName}
            </InlineLink>
          </span>
        ) : null}
        <span>
          <InlineLink href={`/runs/${run.id}`}>{run.id.slice(0, 8)}</InlineLink>
        </span>
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
      {run.summary ? (
        // Mute the whole summary so it reads as secondary to the articles
        // that lead the row; Markdown inherits the tint rather than pinning
        // its own ink. Markdown's paragraphs render at the 16px reading size —
        // the scale the whole row's content shares.
        <div className="mt-2 text-ink-muted">
          <Markdown content={run.summary} />
        </div>
      ) : null}
      {run.articles.length > 0 ? (
        // Article links sit at the same 16px scale as the summary text — the
        // feed is a scanning surface, so the entry's hierarchy comes from ink
        // against the summary's muted tint, not from size.
        <ul className="mt-4 space-y-3 text-base">
          {run.articles.map((article) => (
            <li key={article.slug}>
              <HeadlineLink href={`/runs/${run.id}/articles/${article.slug}`}>
                {article.heading ?? article.name}
              </HeadlineLink>
            </li>
          ))}
        </ul>
      ) : null}
    </StatusBlock>
  );
}
