import type { ReactNode } from "react";
import { splitLeadingHeading } from "../../../shared/extract-first-heading.ts";
import { CopyButton } from "../../design-system/actions/copy-button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { readingStats } from "../../formatters/reading-stats.ts";

/**
 * The article reading view, shared by every producer's article page: title
 * split from the body's leading `# ` heading, breadcrumb, eyebrow, byline
 * with reading stats and a copy control, and the markdown body with section
 * ordinals. Purely presentational — the route resolves the article and its
 * producer context and hands them in.
 */
export function ArticleReader({
  contentMd,
  name,
  createdAt,
  context,
  breadcrumbItems,
  actions,
  now,
}: {
  /** Full stored markdown; its leading `# ` heading becomes the page title. */
  contentMd: string;
  /** Resolved display label — the title fallback, and the series label when it adds context. */
  name: string;
  /** ISO timestamp the article was written. */
  createdAt: string;
  /** Producer label leading the eyebrow — the workflow name, or the session's label. */
  context: string;
  /** Trail above the title; the article's own title is appended as the current crumb. */
  breadcrumbItems: { label: string; href: string }[];
  /** Page-level actions rendered after the body — e.g. a delete control for owners that allow it. */
  actions?: ReactNode;
  /** Clock injection for tests; production callers omit it. */
  now?: Date;
}) {
  // The body's own `# headline` is the article's title; drop it and any
  // assistant preamble before it from the rendered body, and fall back to the
  // article name when the body carries no headline of its own.
  const { heading, body } = splitLeadingHeading(contentMd);
  const displayTitle = heading ?? name;
  // The article name earns its spot in the eyebrow only when it adds context:
  // not when the body already supplies the page title, and not when it merely
  // restates the producer context or the headline. Otherwise fall back to the
  // generic label.
  const seriesLabel = heading !== null && name !== context && name !== heading ? name : "Article";
  const stats = readingStats(body);
  // Copy the article as displayed: the headline normalised to a `#` line plus
  // the preamble-stripped body, so a paste lands a tidy document rather than
  // the raw model output with its lead-in chatter.
  const copyMarkdown = [heading === null ? "" : `# ${heading}`, body]
    .filter((part) => part !== "")
    .join("\n\n");
  return (
    <article>
      <Breadcrumb items={breadcrumbItems} current={displayTitle} />

      <header className="mt-6">
        {/* The eyebrow situates the article under its producer, suffixed with
            the article name as the series label when it adds context (see
            seriesLabel). */}
        <Eyebrow>
          {context} · {seriesLabel}
        </Eyebrow>
        <h1 className="mt-2 font-display text-7xl text-ink italic leading-[0.95] tracking-tight">
          {displayTitle}
        </h1>

        <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-rule border-b pb-3.5">
          <Meta>
            <time dateTime={createdAt} title={createdAt}>
              {formatRelativeTime(createdAt, now)}
            </time>
            <span>{stats.words}</span>
            <span>{stats.readingTime}</span>
          </Meta>
          <CopyButton content={copyMarkdown} label="copy markdown" />
        </div>
      </header>

      <div className="mt-10">
        <Markdown content={body} withSectionOrdinals sectionLevel={2} />
      </div>
      {actions !== undefined ? <div className="mt-10">{actions}</div> : null}
    </article>
  );
}
