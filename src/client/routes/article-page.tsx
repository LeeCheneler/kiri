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
  params: { id: string; name: string };
  now?: Date;
}) {
  return (
    <PageShell left={<SiteNav />} right={<ArticleToc />}>
      <ArticleContent params={params} now={now} />
    </PageShell>
  );
}

/**
 * Published-article content. Reads a single article by `(runId, name)` from
 * the shared query cache and renders its markdown body through the sandboxed
 * design-system `Markdown`. Articles are immutable once written, so the cache
 * never goes stale — there is no live sync.
 */
export function ArticleContent({
  params,
  now,
}: {
  params: { id: string; name: string };
  now?: Date;
}) {
  const article = useArticle(params.id, params.name);

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
            No article named <code className="text-ink">{params.name}</code> on run{" "}
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
  const stats = readingStats(data.contentMd);
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
        current={data.title}
      />

      <header className="mt-6">
        <Eyebrow>{data.workflowName} · Article</Eyebrow>
        <h2 className="mt-2 font-display text-7xl text-ink italic leading-[0.95] tracking-tight">
          {data.title}
        </h2>

        <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-rule border-b pb-3.5">
          <Meta>
            <time dateTime={data.createdAt} title={data.createdAt}>
              {formatRelativeTime(data.createdAt, now)}
            </time>
            <span>{stats.words}</span>
            <span>{stats.readingTime}</span>
          </Meta>
          <CopyButton content={data.contentMd} label="copy markdown" />
        </div>
      </header>

      <div className="mt-10">
        <Markdown content={data.contentMd} withSectionOrdinals downgradeHeaderLevels={2} />
      </div>
    </article>
  );
}
