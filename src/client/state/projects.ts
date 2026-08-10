import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MemoryDetail,
  type ProjectArticleDetail,
  type ProjectDetail,
  type ProjectSummary,
  createProject,
  deleteProject,
  deleteProjectArticle,
  deleteProjectMemory,
  fetchProject,
  fetchProjectArticle,
  fetchProjectMemory,
  fetchProjects,
  patchProject,
  patchProjectMemory,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const projectsKey = ["projects"] as const;
const projectKey = (id: string) => ["project", id] as const;
const projectArticleKey = (id: string, slug: string) => ["project-article", id, slug] as const;
const projectMemoryKey = (id: string, name: string) => ["project-memory", id, name] as const;

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
 * Read a single project-scoped memory in full. Fetched on first use and
 * served from cache thereafter; kept current by `useProjectsLive`, since a
 * session in the project can rewrite it mid-turn.
 */
export function useProjectMemory(id: string, name: string): UseQueryResult<MemoryDetail> {
  return useQuery({
    queryKey: projectMemoryKey(id, name),
    queryFn: async () => (await fetchProjectMemory(id, name)).memory,
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
  // Session lifecycle reshapes a project's session index and counts, but
  // session events carry no project id — restale every project query and let
  // the mounted ones refetch.
  useLiveEvent({
    on: ["session.started", "session.updated", "session.finished", "session.deleted"],
    handler: () => {
      void queryClient.invalidateQueries({ queryKey: ["project"] });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
  // Corpus writes and deletions announce their project id — the project's
  // page, index counts, and the touched article all refresh without a
  // project.* event. Session-owned article events carry none and are ignored.
  useLiveEvent({
    on: ["article.written", "article.deleted"],
    handler: (event) => {
      if (event.projectId === undefined) return;
      void queryClient.invalidateQueries({ queryKey: projectKey(event.projectId) });
      void queryClient.invalidateQueries({
        queryKey: projectArticleKey(event.projectId, event.slug),
      });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
  // Project-scoped memory writes announce their project id — the project's
  // page and the touched memory refresh without a project.* event. Global
  // memory events carry none and belong to the memories caches.
  useLiveEvent({
    on: ["memory.saved", "memory.deleted"],
    handler: (event) => {
      if (event.projectId === undefined) return;
      void queryClient.invalidateQueries({ queryKey: projectKey(event.projectId) });
      void queryClient.invalidateQueries({
        queryKey: projectMemoryKey(event.projectId, event.name),
      });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["project"] });
    void queryClient.invalidateQueries({ queryKey: ["project-article"] });
    void queryClient.invalidateQueries({ queryKey: ["project-memory"] });
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
 * A writer for a project's standing instructions: saves the markdown — a
 * blank body clears them — then invalidates the project's queries so views
 * reflect the server's truth.
 */
export function useSaveProjectInstructions(): (id: string, instructions: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (id, instructions) => {
    await patchProject(id, { instructions });
    void queryClient.invalidateQueries({ queryKey: projectKey(id) });
  };
}

/**
 * A deleter for a project-owned article: removes it from the corpus, then
 * invalidates the project's queries so its indexes drop it and the article's
 * page 404s.
 */
export function useDeleteProjectArticle(): (projectId: string, slug: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (projectId, slug) => {
    await deleteProjectArticle(projectId, slug);
    void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: projectArticleKey(projectId, slug) });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  };
}

/**
 * An updater for a project-scoped memory's summary and/or body: writes the
 * patch, then invalidates the project's queries so views reflect the
 * server's truth.
 */
export function useUpdateProjectMemory(): (
  projectId: string,
  name: string,
  patch: { description?: string; contentMd?: string },
) => Promise<void> {
  const queryClient = useQueryClient();
  return async (projectId, name, patch) => {
    await patchProjectMemory(projectId, name, patch);
    void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: projectMemoryKey(projectId, name) });
  };
}

/**
 * A deleter for a project-scoped memory: removes it, then invalidates the
 * project's queries so its index drops it and the memory's page 404s.
 */
export function useDeleteProjectMemory(): (projectId: string, name: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (projectId, name) => {
    await deleteProjectMemory(projectId, name);
    void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: projectMemoryKey(projectId, name) });
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
    void queryClient.invalidateQueries({ queryKey: ["project-memory", id] });
    void queryClient.invalidateQueries({ queryKey: projectsKey });
  };
}
