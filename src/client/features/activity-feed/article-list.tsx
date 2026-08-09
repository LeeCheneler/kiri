import type { ArticleSummary } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";

/**
 * The articles a feed row produced, set apart from the row's own headline.
 * Both carry standalone links in the display face, so without a device to
 * separate them a row reads as several peer titles rather than one entry and
 * its output. The block indents past the headline — containment is what says
 * "these came out of the above" — under a faint count that doubles as a label.
 * `hrefFor` builds each article's destination, since a run and a session route
 * to theirs differently.
 *
 * Renders nothing for an empty list, so callers can hand over whatever the row
 * carries without guarding first.
 */
export function ArticleList({
  articles,
  hrefFor,
}: {
  articles: ArticleSummary[];
  hrefFor: (article: ArticleSummary) => string;
}) {
  if (articles.length === 0) return null;
  return (
    <div className="mt-4 pl-5">
      <Eyebrow tone="faint">
        {articles.length} article{articles.length === 1 ? "" : "s"}
      </Eyebrow>
      {/* The 16px reading size the rest of the row's content shares — the feed
          is a scanning surface, so the hierarchy here comes from the indent,
          not from shrinking what the row produced. */}
      <ul className="mt-2 space-y-3 text-base">
        {articles.map((article) => (
          <li key={article.slug}>
            <HeadlineLink href={hrefFor(article)}>{article.heading ?? article.name}</HeadlineLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
