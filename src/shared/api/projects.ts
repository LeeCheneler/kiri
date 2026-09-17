import type { ArticleSummary } from "./articles.ts";
import type { MemorySummary } from "./memories.ts";
import type { SessionListEntry } from "./sessions.ts";

/** One project's index entry: the container plus its corpus, session, and open-task sizes. */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  articleCount: number;
  sessionCount: number;
  openTaskCount: number;
}

/**
 * A project in full: the container — including its standing instructions,
 * null when it has none — with its article, memory, and session indexes.
 * Sessions carry the same listing projection as the feed, so both surfaces
 * render the same rows; the page renders them scoped, hiding the redundant
 * project link.
 */
export interface ProjectDetail {
  project: { id: string; name: string; instructions: string | null; createdAt: string };
  articles: ArticleSummary[];
  memories: MemorySummary[];
  sessions: SessionListEntry[];
}

/** The bounded project-page payload, with content counts in place of its paged indexes. */
export interface ProjectOverview {
  project: ProjectDetail["project"];
  memories: MemorySummary[];
  articleCount: number;
  sessionCount: number;
}

/** One cursor-paginated page of a project's article corpus, newest first. */
export interface ProjectArticlesPage {
  articles: ArticleSummary[];
  nextCursor: string | null;
}

/** One cursor-paginated page of a project's top-level sessions, newest first. */
export interface ProjectSessionsPage {
  sessions: SessionListEntry[];
  nextCursor: string | null;
}

/**
 * A project-owned article as seen by its article page — the project-corpus
 * analogue of `SessionArticleDetail`. `heading` is the body's first markdown
 * `# heading`, derived server-side, or null.
 */
export interface ProjectArticleDetail {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  contentMd: string;
  createdAt: string;
  heading: string | null;
}

/** Projects response body. */
export type ProjectsResult = { projects: ProjectSummary[] };

/** Project response body. */
export type ProjectResult = { project: ProjectDetail["project"] };

/** CreateProject request body. */
export type CreateProjectRequest = { name: string };

/** PatchProject request body. */
export type PatchProjectRequest = { name?: string; instructions?: string };
