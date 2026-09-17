import type { PageQuery } from "../../shared/api/pagination.ts";
import type {
  PatchProjectRequest,
  ProjectArticleDetail,
  ProjectArticlesPage,
  ProjectDetail,
  ProjectOverview,
  ProjectResult,
  ProjectSessionsPage,
  ProjectsResult,
} from "../../shared/api/projects.ts";
import type * as requests from "../../shared/api/projects.ts";

import { apiFetch, assertOk, json } from "./http.ts";

/** Fetch every project with its corpus and session counts, newest first. Throws on non-2xx. */
export const fetchProjects = async (): Promise<ProjectsResult> =>
  json<ProjectsResult>(await apiFetch("/api/projects"));

/** Create a project named `name`, returning the persisted row. Throws on non-2xx. */
export const createProject = async (name: string): Promise<ProjectResult> =>
  json<ProjectResult>(
    await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name } satisfies requests.CreateProjectRequest),
    }),
  );

/**
 * Fetch a single project with its article and session indexes. Throws
 * `ApiError` on non-2xx (404 for an unknown id).
 */
export const fetchProject = async (id: string): Promise<ProjectDetail> =>
  json<ProjectDetail>(await apiFetch(`/api/projects/${encodeURIComponent(id)}`));

/** Fetch a project's metadata, memories, and content counts for its project page. */
export const fetchProjectOverview = async (id: string): Promise<ProjectOverview> =>
  json<ProjectOverview>(await apiFetch(`/api/projects/${encodeURIComponent(id)}/overview`));

/** Fetch one cursor-paginated page of a project's article corpus. */
export const fetchProjectArticlesPage = async (
  id: string,
  opts: PageQuery = {},
): Promise<ProjectArticlesPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<ProjectArticlesPage>(
    await apiFetch(`/api/projects/${encodeURIComponent(id)}/articles${qs ? `?${qs}` : ""}`),
  );
};

/** Fetch one cursor-paginated page of a project's top-level sessions. */
export const fetchProjectSessionsPage = async (
  id: string,
  opts: PageQuery = {},
): Promise<ProjectSessionsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<ProjectSessionsPage>(
    await apiFetch(`/api/projects/${encodeURIComponent(id)}/sessions${qs ? `?${qs}` : ""}`),
  );
};

/**
 * Update a project's name and/or standing instructions — blank instructions
 * clear them — returning the updated row. Throws `ApiError` on non-2xx (404
 * for an unknown id).
 */
export const patchProject = async (
  id: string,
  patch: PatchProjectRequest,
): Promise<ProjectResult> =>
  json<ProjectResult>(
    await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch satisfies requests.PatchProjectRequest),
    }),
  );

/**
 * Delete a project permanently, cascading its articles, its sessions, and
 * everything those sessions own. Throws `ApiError` on non-2xx (404 for an
 * unknown id).
 */
export const deleteProject = async (id: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }));
};

/**
 * Delete a project-owned article permanently. Throws `ApiError` on non-2xx
 * (404 when the project or article is missing).
 */
export const deleteProjectArticle = async (projectId: string, slug: string): Promise<void> => {
  await assertOk(
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    ),
  );
};

/**
 * Fetch a single project-owned article by project id and slug. Throws on
 * non-2xx — 400 for a malformed slug, 404 when either the project or the
 * named article is missing.
 */
export const fetchProjectArticle = async (
  projectId: string,
  slug: string,
): Promise<ProjectArticleDetail> =>
  json<ProjectArticleDetail>(
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/articles/${encodeURIComponent(slug)}`,
    ),
  );
