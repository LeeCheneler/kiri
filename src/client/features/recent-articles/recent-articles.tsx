import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useRecentArticles } from "../../state/articles.ts";

/**
 * The home page's right-rail "recently published" shortlist: the newest
 * articles across every workflow, newest first, each linking through to its
 * reading page below a byline of its workflow and relative publish time.
 * Reads the live recent-articles query (kept current by
 * `useRecentArticlesLive`) and renders one of loading, error, empty, or the
 * list beneath a persistent heading, so the rail stays identifiable before the
 * first publish. `now` is injectable so tests render deterministic relative
 * times; production omits it.
 */
export function RecentArticles({ now }: { now?: Date }) {
  return (
    <section>
      {/* Matches the Toc rail's heading treatment so the right rail reads
          consistently as the reader moves between the home and article views. */}
      <h2 className="mb-4 border-rule border-b pb-2 font-mono text-xs tracking-widest text-ink-muted uppercase">
        Recently published
      </h2>
      <RecentArticlesBody now={now} />
    </section>
  );
}

function RecentArticlesBody({ now }: { now?: Date }) {
  const { data, isPending, isError, error } = useRecentArticles();

  if (isPending) return <LoadingState>Loading articles…</LoadingState>;
  if (isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load articles: {error.message}
      </p>
    );
  }
  if (data.length === 0) return <EmptyState>nothing published yet.</EmptyState>;

  return (
    <ul className="space-y-5 text-base">
      {data.map((article) => (
        <li key={`${article.runId}/${article.name}`}>
          <HeadlineLink href={`/runs/${article.runId}/published/${article.name}`}>
            {article.heading ?? article.title}
          </HeadlineLink>
          <div className="mt-1.5">
            <Meta>
              <span>{article.workflowName}</span>
              <span>{formatRelativeTime(article.createdAt, now)}</span>
            </Meta>
          </div>
        </li>
      ))}
    </ul>
  );
}
