import { splitLeadingHeading } from "../../../shared/extract-first-heading.ts";
import { CopyButton } from "../../design-system/actions/copy-button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import type { WikiLinkResolver } from "../../design-system/content/wiki-links.ts";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { readingStats } from "../../formatters/reading-stats.ts";

/**
 * The article reading view, shared by every producer's article page: title
 * split from the body's leading `# ` heading, breadcrumb, a kind eyebrow,
 * byline with reading stats and a copy control, and the markdown body with
 * section ordinals. The eyebrow names the kind alone — the breadcrumb above it
 * already names the container, so a kicker echoing that would read as the same
 * string twice.
 *
 * Purely presentational — the route resolves the article and the trail that
 * situates it, and hands them in.
 */
export function ArticleReader({
  contentMd,
  name,
  createdAt,
  breadcrumbItems,
  wikiLinkResolver,
  now,
}: {
  /** Full stored markdown; its leading `# ` heading becomes the page title. */
  contentMd: string;
  /** Resolved display label, standing in as the title when the body carries no heading of its own. */
  name: string;
  /** ISO timestamp the article was written. */
  createdAt: string;
  /** Trail above the title; the article's own title is appended as the current crumb. */
  breadcrumbItems: { label: string; href: string }[];
  /** Turns `[[slug]]` references into links — the project and session readers pass one over their owner's article index; a run's reader leaves the syntax literal. */
  wikiLinkResolver?: WikiLinkResolver;
  /** Clock injection for tests; production callers omit it. */
  now?: Date;
}) {
  // The body's own `# headline` is the article's title; drop it and any
  // assistant preamble before it from the rendered body, and fall back to the
  // article name when the body carries no headline of its own.
  const { heading, body } = splitLeadingHeading(contentMd);
  const displayTitle = heading ?? name;
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
        {/* Names the kind and nothing else. The breadcrumb directly above
            already names the container — as a link, which a kicker can't be —
            so repeating it here would read as the same string twice. */}
        <Eyebrow>Article</Eyebrow>
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
        <Markdown
          content={body}
          withSectionOrdinals
          sectionLevel={2}
          wikiLinkResolver={wikiLinkResolver}
        />
      </div>
    </article>
  );
}
