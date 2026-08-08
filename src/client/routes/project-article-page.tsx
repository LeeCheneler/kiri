import { ApiError } from "../api.ts";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { ArticleReader } from "../features/article/article-reader.tsx";
import { ArticleToc } from "../features/article/article-toc.tsx";
import { DeleteArticleButton } from "../features/article/delete-article-button.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";
import { useDeleteProjectArticle, useProject, useProjectArticle } from "../state/projects.ts";

/**
 * Project article route. Composes the article content into the page shell,
 * with the in-article table of contents as right-rail marginalia.
 *
 * `now` is injectable so component tests render deterministic relative
 * timestamps; production callers omit it and pick up the system clock.
 */
export function ProjectArticlePage({
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
  const article = useProjectArticle(params.id, params.slug);
  return (
    <PageShell
      left={<SiteNav />}
      right={<ArticleToc key={article.isSuccess ? `${params.id}/${params.slug}` : "pending"} />}
    >
      <ProjectArticleContent params={params} now={now} />
    </PageShell>
  );
}

/**
 * Project article content. Reads a single article by `(projectId, slug)`
 * from the shared query cache — kept live-synced, since any of the
 * project's sessions can edit it — and renders it through the shared
 * `ArticleReader`, situated under its owning project.
 */
export function ProjectArticleContent({
  params,
  now,
}: {
  params: { id: string; slug: string };
  now?: Date;
}) {
  const article = useProjectArticle(params.id, params.slug);
  const deleteArticle = useDeleteProjectArticle();
  // The owning project's name situates the article; fall back to the short
  // id while it loads (or if the project query errors independently).
  const projectName = useProject(params.id).data?.project.name ?? params.id.slice(0, 8);

  if (article.isPending) {
    return <LoadingState>Loading article…</LoadingState>;
  }
  if (article.isError) {
    if (article.error instanceof ApiError && article.error.status === 404) {
      return (
        <section>
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              { label: projectName, href: `/projects/${params.id}` },
            ]}
            current="Not found"
          />
          <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Article not found</h2>
          <p className="mt-3 font-mono text-sm text-ink-muted">
            No article named <code className="text-ink">{params.slug}</code> on this project.
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
      context={`Project ${projectName}`}
      breadcrumbItems={[
        { label: "Projects", href: "/projects" },
        { label: projectName, href: `/projects/${data.projectId}` },
      ]}
      actions={
        <DeleteArticleButton
          onDelete={() => deleteArticle(data.projectId, data.slug)}
          returnTo={`/projects/${data.projectId}`}
        />
      }
      now={now}
    />
  );
}
