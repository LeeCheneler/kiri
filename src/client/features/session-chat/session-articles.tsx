import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { useSessionArticles } from "../../state/articles.ts";
import { useProject } from "../../state/projects.ts";
import { useSession } from "../../state/sessions.ts";

/**
 * The articles surfaced beside a session's chat. A projectless session lists
 * the articles it has written itself; a project session lists its project's
 * shared corpus instead — the documents its article tools actually operate
 * on — under the owning project's name, which links through to the project
 * page. Sits in the session page's right rail and stays live: an article
 * written mid-turn pops in without a refresh.
 */
export function SessionArticles({ id }: { id: string }) {
  const projectId = useSession(id).data?.session.projectId ?? null;
  if (projectId !== null) return <ProjectCorpus projectId={projectId} />;
  return <OwnArticles id={id} />;
}

// The projectless rail: what this session has written. Hidden entirely while
// the session has written nothing. Label-to-content and item spacing mirror
// the aside's field lockups, so the rail reads on the controls' rhythm.
function OwnArticles({ id }: { id: string }) {
  const articles = useSessionArticles(id).data ?? [];
  if (articles.length === 0) return null;
  return (
    <section>
      <Eyebrow tone="muted">Articles</Eyebrow>
      <ul className="mt-1.5 space-y-4 text-sm">
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

// The project rail: the owning project's link under its own label, then the
// shared corpus under an Articles label of its own — two sections, so the
// project link never reads as one of the articles. The project link renders
// even with an empty corpus — it is how the chat navigates home to its
// container.
function ProjectCorpus({ projectId }: { projectId: string }) {
  const project = useProject(projectId).data;
  if (project === undefined) return null;
  return (
    <section>
      <Eyebrow tone="muted">Project</Eyebrow>
      <div className="mt-1.5 text-sm">
        <HeadlineLink href={`/projects/${encodeURIComponent(projectId)}`}>
          {project.project.name}
        </HeadlineLink>
      </div>
      {project.articles.length > 0 ? (
        <div className="mt-8">
          <Eyebrow tone="muted">Articles</Eyebrow>
          <ul className="mt-1.5 space-y-4 text-sm">
            {project.articles.map((article) => (
              <li key={article.slug}>
                <HeadlineLink
                  href={`/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(article.slug)}`}
                >
                  {article.heading ?? article.name}
                </HeadlineLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
