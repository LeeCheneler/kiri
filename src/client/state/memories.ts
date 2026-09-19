import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MemoryDetail,
  type MemorySummary,
  deleteMemory,
  fetchMemories,
  fetchMemory,
  patchMemory,
} from "../api.ts";
import { memoriesKey, memoryKey } from "./query-keys.ts";

/**
 * Read the memory index — every memory's name, summary, and last update,
 * alphabetically. Fetched on first use and served from cache thereafter;
 * kept current by `<LiveSync>`.
 */
export function useMemories(): UseQueryResult<MemorySummary[]> {
  return useQuery({
    queryKey: memoriesKey,
    queryFn: async () => (await fetchMemories()).memories,
  });
}

/**
 * Read a single memory in full by name. Fetched on first use and served
 * from cache thereafter; kept current by `<LiveSync>`.
 */
export function useMemory(name: string): UseQueryResult<MemoryDetail> {
  return useQuery({
    queryKey: memoryKey(name),
    queryFn: async () => (await fetchMemory(name)).memory,
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
