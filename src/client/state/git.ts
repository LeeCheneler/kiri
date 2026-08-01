import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CreateWorktreeResult,
  type GitOverview,
  type PruneWorktreesResult,
  type RemoveWorktreeResult,
  createWorktree,
  fetchGitOverview,
  pruneWorktrees,
  refreshGitOverview,
  removeWorktree,
} from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const gitKey = ["git"] as const;

/**
 * Read the grouped git overview — every repo with its checkouts. Fetched on
 * first use and served from cache thereafter; kept current by `useGitLive`.
 */
export function useGitOverview(): UseQueryResult<GitOverview> {
  return useQuery({ queryKey: gitKey, queryFn: fetchGitOverview });
}

/**
 * Refetch the git overview whenever the server reports discovery has
 * changed, and on event-stream reconnect. Mount once near the root via
 * `<LiveSync>`.
 */
export function useGitLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["git.changed"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: gitKey });
    },
  });
}

/**
 * A trigger that re-runs discovery on the server, then invalidates the cached
 * overview so the page reflects the server's truth. Rejects on a failed
 * refresh so the caller can surface it.
 */
export function useRefreshGit(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await refreshGitOverview();
    void queryClient.invalidateQueries({ queryKey: gitKey });
  };
}

/**
 * Create a worktree, then invalidate the cached overview so the listing reflects
 * the server's truth — never an optimistic guess at it. Resolves with the
 * operation's result, including the prep report; rejects on a failed create so
 * the caller can surface it.
 */
export function useCreateWorktree(): (body: {
  repo: string;
  branch: string;
  name?: string;
  baseRef?: string;
}) => Promise<CreateWorktreeResult> {
  const queryClient = useQueryClient();
  return async (body) => {
    const result = await createWorktree(body);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}

/**
 * Remove a linked worktree, then invalidate the cached overview. Resolves with
 * the operation's result — the deleted branch's sha and any non-fatal warnings —
 * and rejects on a refusal (an unforced dirty worktree) so the caller can
 * surface it.
 */
export function useRemoveWorktree(): (
  path: string,
  force?: boolean,
) => Promise<RemoveWorktreeResult> {
  const queryClient = useQueryClient();
  return async (path, force) => {
    const result = await removeWorktree(path, force);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}

/**
 * Prune a repo's stale worktree admin entries, then invalidate the cached
 * overview. Resolves with the paths that were cleared; rejects on a failure.
 */
export function usePruneWorktrees(): (repo: string) => Promise<PruneWorktreesResult> {
  const queryClient = useQueryClient();
  return async (repo) => {
    const result = await pruneWorktrees(repo);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}
