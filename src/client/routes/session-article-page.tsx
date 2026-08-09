import { ApiError } from "../api.ts";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { ArticleReader } from "../features/article/article-reader.tsx";
import { ArticleToc } from "../features/article/article-toc.tsx";
import { DeleteArticleButton } from "../features/article/delete-article-button.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useDeleteSessionArticle, useSessionArticle } from "../state/articles.ts";

/**
 * Session article route. Composes the article content into the page shell,
 * with the in-article table of contents as right-rail marginalia.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function SessionArticlePage({
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
  const article = useSessionArticle(params.id, params.slug);
  return (
    <PageShell
      left={<SiteNav />}
      right={
        <div className="flex flex-col gap-8">
          <ArticleToc key={article.isSuccess ? `${params.id}/${params.slug}` : "pending"} />
          <SessionArticleActions params={params} />
        </div>
      }
    >
      <SessionArticleContent params={params} now={now} />
    </PageShell>
  );
}

/**
 * The article's owner actions, rendered in the right rail under the table of
 * contents. Renders nothing until the article resolves — there's nothing to
 * act on, and the loading and not-found states own the centre column.
 */
export function SessionArticleActions({ params }: { params: { id: string; slug: string } }) {
  const article = useSessionArticle(params.id, params.slug);
  const deleteArticle = useDeleteSessionArticle();
  if (!article.isSuccess) return null;
  const data = article.data;
  return (
    <DeleteArticleButton
      onDelete={() => deleteArticle(data.sessionId, data.slug)}
      returnTo={`/sessions/${data.sessionId}`}
    />
  );
}

/**
 * Session article content. Reads a single article by `(sessionId, slug)`
 * from the shared query cache — kept live-synced, since the session can edit
 * it — and renders it through the shared `ArticleReader`, situated under its
 * producing session.
 */
export function SessionArticleContent({
  params,
  now,
}: {
  params: { id: string; slug: string };
  now?: Date;
}) {
  const article = useSessionArticle(params.id, params.slug);

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
              { label: params.id.slice(0, 8), href: `/sessions/${params.id}` },
            ]}
            current="Not found"
          />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Article not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No article named <code className="text-ink">{params.slug}</code> on session{" "}
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
      context={`Session ${data.sessionId.slice(0, 8)}`}
      breadcrumbItems={[
        { label: "Activity", href: "/" },
        { label: data.sessionId.slice(0, 8), href: `/sessions/${data.sessionId}` },
      ]}
      now={now}
    />
  );
}
