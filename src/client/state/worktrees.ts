import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type WorktreesOverview, fetchWorktrees, refreshWorktrees } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const worktreesKey = ["worktrees"] as const;

/**
 * Read the grouped worktree overview. Fetched on first use and served from
 * cache thereafter; kept current by `useWorktreesLive`.
 */
export function useWorktrees(): UseQueryResult<WorktreesOverview> {
  return useQuery({ queryKey: worktreesKey, queryFn: fetchWorktrees });
}

/**
 * Refetch the worktree overview whenever the server reports discovery has
 * changed, and on event-stream reconnect. Mount once near the root via
 * `<LiveSync>`.
 */
export function useWorktreesLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["worktrees.changed"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: worktreesKey });
    },
  });
}

/**
 * A trigger that re-runs discovery on the server, then invalidates the cached
 * overview so the page reflects the server's truth. Rejects on a failed
 * refresh so the caller can surface it.
 */
export function useRefreshWorktrees(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await refreshWorktrees();
    void queryClient.invalidateQueries({ queryKey: worktreesKey });
  };
}
