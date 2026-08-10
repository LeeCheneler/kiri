import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MemoryDetail,
  type MemorySummary,
  deleteMemory,
  fetchMemories,
  fetchMemory,
  patchMemory,
} from "../api.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";

const memoriesKey = ["memories"] as const;
const memoryKey = (name: string) => ["memory", name] as const;

/**
 * Read the memory index — every memory's name, summary, and last update,
 * alphabetically. Fetched on first use and served from cache thereafter;
 * kept current by `useMemoriesLive`, mounted once near the root via
 * `<LiveSync>`.
 */
export function useMemories(): UseQueryResult<MemorySummary[]> {
  return useQuery({
    queryKey: memoriesKey,
    queryFn: async () => (await fetchMemories()).memories,
  });
}

/**
 * Read a single memory in full by name. Fetched on first use and served
 * from cache thereafter; kept current by `useMemoriesLive`.
 */
export function useMemory(name: string): UseQueryResult<MemoryDetail> {
  return useQuery({
    queryKey: memoryKey(name),
    queryFn: async () => (await fetchMemory(name)).memory,
  });
}

/**
 * Bridges workspace-global memory events to the memory caches: a save or
 * delete invalidates the named memory's detail and the index, whether or not
 * a consumer is mounted — a session saving a memory mid-turn pops into an
 * open list, and a deleted memory 404s rather than rendering from cache.
 * Events carrying a project id belong to that project's caches and are
 * ignored here. Reconnect re-syncs every memory query. Mount once near the
 * root via `<LiveSync>`.
 */
export function useMemoriesLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent({
    on: ["memory.saved", "memory.deleted"],
    handler: (event) => {
      if (event.projectId !== undefined) return;
      void queryClient.invalidateQueries({ queryKey: memoryKey(event.name) });
      void queryClient.invalidateQueries({ queryKey: memoriesKey });
    },
  });
  useLiveReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: ["memory"] });
    void queryClient.invalidateQueries({ queryKey: memoriesKey });
  });
}

/**
 * An updater for a memory's summary and/or body: writes the patch, then
 * invalidates the memory's queries so views reflect the server's truth.
 */
export function useUpdateMemory(): (
  name: string,
  patch: { description?: string; contentMd?: string },
) => Promise<void> {
  const queryClient = useQueryClient();
  return async (name, patch) => {
    await patchMemory(name, patch);
    void queryClient.invalidateQueries({ queryKey: memoryKey(name) });
    void queryClient.invalidateQueries({ queryKey: memoriesKey });
  };
}

/**
 * A deleter for a memory: removes it, then invalidates the memory's queries
 * so the index drops it and its detail page 404s.
 */
export function useDeleteMemory(): (name: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (name) => {
    await deleteMemory(name);
    void queryClient.invalidateQueries({ queryKey: memoryKey(name) });
    void queryClient.invalidateQueries({ queryKey: memoriesKey });
  };
}
