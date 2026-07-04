import type { ArticleSummary } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";

/**
 * The articles a run published, as a stacked list of links through to their
 * pages — each read by its body's first heading, falling back to its series
 * name. Sits unlabelled beneath the run's summary, mirroring how a feed row
 * leads with its articles; reads the stored article rows, so it renders for
 * any run that published, whatever its definition snapshot's shape. Hidden
 * entirely when the run published nothing.
 */
export function RunArticles({
  runId,
  articles,
}: {
  runId: string;
  articles: ArticleSummary[];
}) {
  if (articles.length === 0) return null;
  return (
    <ul className="mt-8 space-y-4 text-base">
      {articles.map((article) => (
        <li key={article.slug}>
          <HeadlineLink href={`/runs/${runId}/articles/${article.slug}`}>
            {article.heading ?? article.name}
          </HeadlineLink>
        </li>
      ))}
    </ul>
  );
}
