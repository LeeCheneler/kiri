import { useState } from "react";
import type { SessionArticleActivity } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Drawer } from "../../design-system/surfaces/drawer.tsx";
import { useSessionArticleActivity } from "../../state/articles.ts";
import { useSession } from "../../state/sessions.ts";

/** Lists articles this session created or edited, latest write first; hides an empty list. */
export function SessionArticles({ id, compact = false }: { id: string; compact?: boolean }) {
  const session = useSession(id);
  const query = useSessionArticleActivity(id);
  const [open, setOpen] = useState(false);
  const articles = query.data ?? [];
  if (!session.data || (articles.length === 0 && !open)) return null;

  const projectId = session.data.session.projectId;
  const href = (slug: string) =>
    projectId === null
      ? `/sessions/${encodeURIComponent(id)}/articles/${encodeURIComponent(slug)}`
      : `/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(slug)}`;

  return (
    <section>
      {compact ? (
        <Button variant="dismissive" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Articles ({articles.length})
        </Button>
      ) : (
        <>
          <Eyebrow tone="muted">Session articles</Eyebrow>
          <div className="mt-1.5">
            <ArticleList articles={articles} href={href} />
          </div>
        </>
      )}
      {open ? (
        <Drawer title="Session articles" side="right" onClose={() => setOpen(false)}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ArticleList articles={articles} href={href} />
            {articles.length === 0 ? <p>No session articles remain.</p> : null}
          </div>
        </Drawer>
      ) : null}
    </section>
  );
}

function ArticleList({
  articles,
  href,
}: { articles: SessionArticleActivity[]; href: (slug: string) => string }) {
  return (
    <ul className="space-y-4 text-sm">
      {articles.map((article) => (
        <li key={article.slug}>
          <HeadlineLink href={href(article.slug)}>{article.heading ?? article.name}</HeadlineLink>
        </li>
      ))}
    </ul>
  );
}
