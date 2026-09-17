/**
 * A run's article as seen by the run-detail consumer. The
 * markdown body lives on the dedicated article route — only metadata
 * needed to render the "Articles" section row travels with the run.
 *
 * `heading` is the article body's first markdown `# heading`, derived
 * server-side, or null when the body has no top-level heading. Surfaces
 * that list articles use it as a sub-byline so identically-titled
 * articles from the same workflow are distinguishable.
 */
export interface ArticleSummary {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: string;
}

/**
 * One run's article, fetched by `(runId, name)`. Carries the
 * full markdown body for the dedicated article page; the run detail
 * payload only carries summary metadata so its size stays bounded.
 *
 * `heading` is the article body's first markdown `# heading` (null when
 * the body has none), `gitSha`/`gitDirty` mirror the parent run's
 * working-tree state, and `startedAt`/`finishedAt` carry the run's
 * lifecycle timestamps so the article page can render duration without
 * a second fetch.
 */
export interface ArticleDetail {
  id: string;
  runId: string;
  slug: string;
  name: string;
  contentMd: string;
  createdAt: string;
  workflowName: string;
  heading: string | null;
  gitSha: string | null;
  gitDirty: boolean | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * A session-produced article as seen by its article page. Leaner than a
 * run's `ArticleDetail`: a session has no workflow, git state, or run
 * lifecycle to situate the article under — the producing session's id and
 * the article's own timestamp carry the context. `heading` is the body's
 * first markdown `# heading`, derived server-side, or null.
 */
export interface SessionArticleDetail {
  id: string;
  sessionId: string;
  /** The destination for an article rehomed by moving its session into a project. */
  projectId?: string | null;
  /** How the producing session is named wherever it is listed: its title, else its opening message, else its short id. */
  sessionLabel: string;
  slug: string;
  name: string;
  contentMd: string;
  createdAt: string;
  heading: string | null;
}

/** Articles response body. */
export type ArticlesResult = { articles: ArticleSummary[] };
