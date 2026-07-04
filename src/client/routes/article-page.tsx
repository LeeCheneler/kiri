import { ApiError } from "../api.ts";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { ArticleReader } from "../features/article/article-reader.tsx";
import { ArticleToc } from "../features/article/article-toc.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useArticle } from "../state/articles.ts";

/**
 * Article route. Composes the article content into the page shell,
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
  // The right-rail TOC reads the rendered body straight from the document. Remount
  // it once the article resolves so its initial collect runs with the body — and
  // its `section-NN` anchors — already committed, rather than depending on a
  // mutation observer to catch the load transition.
  const article = useArticle(params.id, params.slug);
  return (
    <PageShell
      left={<SiteNav />}
      right={<ArticleToc key={article.isSuccess ? `${params.id}/${params.slug}` : "pending"} />}
    >
      <ArticleContent params={params} now={now} />
    </PageShell>
  );
}

/**
 * Article content. Reads a single article by `(runId, slug)` from
 * the shared query cache and renders it through the shared `ArticleReader`,
 * situated under its producing workflow and run. Run articles are immutable
 * once written, so the cache never goes stale — there is no live sync.
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
  return (
    <ArticleReader
      contentMd={data.contentMd}
      name={data.name}
      createdAt={data.createdAt}
      context={data.workflowName}
      breadcrumbItems={[
        { label: "Activity", href: "/" },
        { label: data.workflowName, href: `/workflows/${encodeURIComponent(data.workflowName)}` },
        { label: data.runId.slice(0, 8), href: `/runs/${data.runId}` },
      ]}
      now={now}
    />
  );
}
