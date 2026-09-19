import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ArticleSummary,
  type MemoryDetail,
  type ProjectArticleDetail,
  type ProjectDetail,
  type ProjectOverview,
  type ProjectSummary,
  type SessionListEntry,
  createProject,
  deleteProject,
  deleteProjectArticle,
  deleteProjectMemory,
  fetchProject,
  fetchProjectArticle,
  fetchProjectArticlesPage,
  fetchProjectMemory,
  fetchProjectOverview,
  fetchProjectSessionsPage,
  fetchProjects,
  patchProject,
  patchProjectMemory,
} from "../api.ts";
import { projectArticleKey, projectKey, projectMemoryKey, projectsKey } from "./query-keys.ts";

/** Page size for each project content column; mirrors the server default. */
const PROJECT_PAGE_SIZE = 25;

/**
 * Read the project index — every project with its corpus and session
 * counts, newest first. Fetched on first use and served from cache
 * thereafter; kept current by `<LiveSync>`.
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
 * `<LiveSync>`.
 */
export function useProject(id: string): UseQueryResult<ProjectDetail> {
  return useQuery({ queryKey: projectKey(id), queryFn: () => fetchProject(id) });
}

/** Read the bounded metadata and counts used by the project page. */
export function useProjectOverview(id: string): UseQueryResult<ProjectOverview> {
  return useQuery({
    queryKey: [...projectKey(id), "overview"],
    queryFn: () => fetchProjectOverview(id),
  });
}

/** Read a project's article corpus as an infinite, newest-first feed. */
export function useProjectArticlesFeed(
  id: string,
): UseInfiniteQueryResult<ArticleSummary[], Error> {
  return useInfiniteQuery({
    queryKey: [...projectKey(id), "articles"],
    queryFn: ({ pageParam }) =>
      fetchProjectArticlesPage(id, { cursor: pageParam, limit: PROJECT_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.articles),
  });
}

/** Read a project's top-level sessions as an infinite, newest-first feed. */
export function useProjectSessionsFeed(
  id: string,
): UseInfiniteQueryResult<SessionListEntry[], Error> {
  return useInfiniteQuery({
    queryKey: [...projectKey(id), "sessions"],
    queryFn: ({ pageParam }) =>
      fetchProjectSessionsPage(id, { cursor: pageParam, limit: PROJECT_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.sessions),
  });
}

/**
 * Read a single project-owned article, fetching on first use and serving
 * the cache thereafter. The corpus is editable — any of the project's
 * sessions can rewrite an article — so the cache is kept current by
 * `<LiveSync>`.
 */
export function useProjectArticle(id: string, slug: string): UseQueryResult<ProjectArticleDetail> {
  return useQuery({
    queryKey: projectArticleKey(id, slug),
    queryFn: () => fetchProjectArticle(id, slug),
  });
}

/**
 * Read a single project-scoped memory in full. Fetched on first use and
 * served from cache thereafter; kept current by `<LiveSync>`, since a
 * session in the project can rewrite it mid-turn.
 */
export function useProjectMemory(id: string, name: string): UseQueryResult<MemoryDetail> {
  return useQuery({
    queryKey: projectMemoryKey(id, name),
    queryFn: async () => (await fetchProjectMemory(id, name)).memory,
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
