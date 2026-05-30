import type { RunListEntry } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatDuration, formatRelativeTime } from "../../formatters/format-time.ts";

/**
 * One run in the workflow runs feed, edged with its status colour. A mono
 * byline tops the entry — status, the relative start time (which carries the
 * link through to the run detail), and the duration. The run's own name is
 * left off: the feed is already scoped to a single workflow, so a name would
 * repeat on every row. An optional summary renders below as prose, and the
 * run's published articles follow as a stacked list — each an eyebrow of the
 * article's name above a link carrying its first heading (falling back to its
 * title). With no name heading, those articles are the row's visual lead.
 *
 * Runs still in flight have no `finishedAt`, so the duration is omitted — the
 * `running` status word already signals the live state. `now` is injectable so
 * tests render deterministic relative times; production omits it.
 */
export function RunRow({ run, now }: { run: RunListEntry; now?: Date }) {
  return (
    <StatusBlock status={run.status}>
      <Meta>
        <Status status={run.status} />
        {/* Wrap the link so Meta's middot separator attaches to this span, not
            the anchor — on the anchor it joins the link's underline and hit area. */}
        <span>
          <InlineLink href={`/runs/${run.id}`}>{formatRelativeTime(run.startedAt, now)}</InlineLink>
        </span>
        {run.finishedAt ? (
          <span className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</span>
        ) : null}
      </Meta>
      {run.summary ? (
        // Mute the whole summary so it reads as secondary to the articles
        // that lead the row; Markdown inherits the tint rather than pinning
        // its own ink.
        <div className="mt-2 text-sm text-ink-muted">
          <Markdown content={run.summary} />
        </div>
      ) : null}
      {run.articles.length > 0 ? (
        <ul className="mt-4 space-y-3 text-xl">
          {run.articles.map((article) => (
            <li key={article.name}>
              <p className="font-mono text-xs text-ink-muted uppercase tracking-widest">
                {article.name}
              </p>
              <HeadlineLink href={`/runs/${run.id}/published/${article.name}`}>
                {article.heading ?? article.title}
              </HeadlineLink>
            </li>
          ))}
        </ul>
      ) : null}
    </StatusBlock>
  );
}
