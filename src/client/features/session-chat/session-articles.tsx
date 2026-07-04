import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { useSessionArticles } from "../../state/articles.ts";

/**
 * The articles this session has written, as a stacked list of links through
 * to their reading pages — each read by its body's first heading, falling
 * back to its name. Sits in the session page's right rail and stays live:
 * an article the model writes mid-turn pops in without a refresh. Hidden
 * entirely while the session has written nothing.
 */
export function SessionArticles({ id }: { id: string }) {
  const articles = useSessionArticles(id).data ?? [];
  if (articles.length === 0) return null;
  return (
    <section>
      <Eyebrow tone="muted">Articles</Eyebrow>
      <ul className="mt-3 space-y-3 text-sm">
        {articles.map((article) => (
          <li key={article.slug}>
            <HeadlineLink href={`/sessions/${id}/articles/${article.slug}`}>
              {article.heading ?? article.name}
            </HeadlineLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
