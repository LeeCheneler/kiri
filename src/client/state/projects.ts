import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ProjectArticleDetail,
  type ProjectDetail,
  type ProjectSummary,
  createProject,
  deleteProject,
  fetchProject,
  fetchProjectArticle,
  fetchProjects,
  patchProject,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const projectsKey = ["projects"] as const;
const projectKey = (id: string) => ["project", id] as const;
const projectArticleKey = (id: string, slug: string) => ["project-article", id, slug] as const;

/**
 * Read the project index — every project with its corpus and session
 * counts, newest first. Fetched on first use and served from cache
 * thereafter; kept current by `useProjectsLive`, mounted once near the
 * root via `<LiveSync>`.
 */
export function useProjects(): UseQueryResult<ProjectSummary[]> {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async () => (await fetchProjects()).projects,
  });
}

/**
 * Read a single project with its article and session indexes. Fetched on
 * first use and served from cache thereafter; kept current by
 * `useProjectsLive`.
 */
export function useProject(id: string): UseQueryResult<ProjectDetail> {
  return useQuery({ queryKey: projectKey(id), queryFn: () => fetchProject(id) });
}

/**
 * Read a single project-owned article, fetching on first use and serving
 * the cache thereafter. The corpus is editable — any of the project's
 * sessions can rewrite an article — so the cache is kept current by
 * `useProjectsLive`.
 */
export function useProjectArticle(id: string, slug: string): UseQueryResult<ProjectArticleDetail> {
  return useQuery({
    queryKey: projectArticleKey(id, slug),
    queryFn: () => fetchProjectArticle(id, slug),
  });
}

/**
 * Bridges project events to the project caches: any create, rename, or
 * delete invalidates the affected project's detail, its articles, and the
 * index, whether or not a consumer is mounted — a deleted project 404s
 * rather than rendering from cache. Reconnect re-syncs every project
 * query. Mount once near the root via `<LiveSync>`.
 */
export function useProjectsLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["project.created", "project.updated", "project.deleted"],
    handler: (event) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(event.id) });
      void queryClient.invalidateQueries({ queryKey: ["project-article", event.id] });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["project"] });
    void queryClient.invalidateQueries({ queryKey: ["project-article"] });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  });
}

/**
 * A creator for a project: persists it, invalidates the index, and returns
 * the new row so callers can navigate to it.
 */
export function useCreateProject(): (name: string) => Promise<{ id: string }> {
  const queryClient = useQueryClient();
  return async (name) => {
    const { project } = await createProject(name);
    void queryClient.invalidateQueries({ queryKey: projectsKey });
    return { id: project.id };
  };
}

/**
 * A renamer for a project: writes the new name, then invalidates the
 * project's queries so views reflect the server's truth.
 */
export function useRenameProject(): (id: string, name: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (id, name) => {
    await patchProject(id, { name });
    void queryClient.invalidateQueries({ queryKey: projectKey(id) });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  };
}

/**
 * A deleter for a project: removes the whole container, then invalidates
 * the project's queries so the index drops it and its detail page 404s.
 */
export function useDeleteProject(): (id: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (id) => {
    await deleteProject(id);
    void queryClient.invalidateQueries({ queryKey: projectKey(id) });
    void queryClient.invalidateQueries({ queryKey: ["project-article", id] });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  };
}
