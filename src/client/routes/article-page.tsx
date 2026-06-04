import { splitLeadingHeading } from "../../shared/extract-first-heading.ts";
import { ApiError } from "../api.ts";
import { CopyButton } from "../design-system/actions/copy-button.tsx";
import { Eyebrow } from "../design-system/content/eyebrow.tsx";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Markdown } from "../design-system/content/markdown.tsx";
import { Meta } from "../design-system/content/meta.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { ArticleToc } from "../features/article/article-toc.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { formatRelativeTime } from "../formatters/format-time.ts";
import { readingStats } from "../formatters/reading-stats.ts";
import { useArticle } from "../state/articles.ts";

/**
 * Published-article route. Composes the article content into the page shell,
 * with the in-article table of contents as right-rail marginalia.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ArticlePage({
  params,
  now,
}: {
  params: { id: string; slug: string };
  now?: Date;
}) {
  return (
    <PageShell left={<SiteNav />} right={<ArticleToc />}>
      <ArticleContent params={params} now={now} />
    </PageShell>
  );
}

/**
 * Published-article content. Reads a single article by `(runId, slug)` from
 * the shared query cache and renders its markdown body through the sandboxed
 * design-system `Markdown`. Articles are immutable once written, so the cache
 * never goes stale — there is no live sync.
 */
export function ArticleContent({
  params,
  now,
}: {
  params: { id: string; slug: string };
  now?: Date;
}) {
  const article = useArticle(params.id, params.slug);

  if (article.isPending) {
    return <LoadingState>Loading article…</LoadingState>;
  }
  if (article.isError) {
    if (article.error instanceof ApiError && article.error.status === 404) {
      return (
        <section>
          <Breadcrumb
            items={[
              { label: "Activity", href: "/" },
              { label: params.id.slice(0, 8), href: `/runs/${params.id}` },
            ]}
            current="Not found"
          />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Article not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No article named <code className="text-ink">{params.slug}</code> on run{" "}
            <code className="text-ink">{params.id}</code>.
          </p>
        </section>
      );
    }
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load article: {article.error.message}
      </p>
    );
  }

  const data = article.data;
  // The body's own `# headline` is the article's title; drop it and any
  // assistant preamble before it from the rendered body, and fall back to the
  // publish name when the body carries no headline of its own.
  const { heading, body } = splitLeadingHeading(data.contentMd);
  const displayTitle = heading ?? data.name;
  // The publish name earns its spot in the eyebrow only when it adds context:
  // not when the body already supplies the page title, and not when it merely
  // restates the workflow name or the headline. Otherwise fall back to the
  // generic label.
  const seriesLabel =
    heading !== null && data.name !== data.workflowName && data.name !== heading
      ? data.name
      : "Article";
  const stats = readingStats(body);
  // Copy the article as displayed: the headline normalised to a `#` line plus
  // the preamble-stripped body, so a paste lands a tidy document rather than
  // the raw model output with its lead-in chatter.
  const copyMarkdown = [heading === null ? "" : `# ${heading}`, body]
    .filter((part) => part !== "")
    .join("\n\n");
  return (
    <article>
      <Breadcrumb
        items={[
          { label: "Activity", href: "/" },
          {
            label: data.workflowName,
            href: `/workflows/${encodeURIComponent(data.workflowName)}`,
          },
          { label: data.runId.slice(0, 8), href: `/runs/${data.runId}` },
        ]}
        current={displayTitle}
      />

      <header className="mt-6">
        {/* The eyebrow situates the article under its workflow, suffixed with
            the publish name as the series label when it adds context (see
            seriesLabel). */}
        <Eyebrow>
          {data.workflowName} · {seriesLabel}
        </Eyebrow>
        <h1 className="mt-2 font-display text-7xl text-ink italic leading-[0.95] tracking-tight">
          {displayTitle}
        </h1>

        <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-rule border-b pb-3.5">
          <Meta>
            <time dateTime={data.createdAt} title={data.createdAt}>
              {formatRelativeTime(data.createdAt, now)}
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
    </article>
  );
}
