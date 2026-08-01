import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Changeset,
  type ChangesetView,
  type CreateWorktreeResult,
  type FetchResult,
  type FilePatch,
  type GitOverview,
  type PruneWorktreesResult,
  type PullResult,
  type RemoveWorktreeResult,
  createWorktree,
  fetchAllRepos,
  fetchChangeset,
  fetchFilePatch,
  fetchGitOverview,
  fetchRepo,
  pruneWorktrees,
  pullCheckout,
  refreshGitOverview,
  removeWorktree,
} from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const gitKey = ["git"] as const;

// Diffs are computed per request rather than read from the overview snapshot,
// so they cache under a root of their own. Keeping them out of `gitKey` means an
// operation invalidating the overview — a fetch, a pull, a worktree change —
// doesn't drag every diff on screen into a recompute behind it.
const changesetKey = ["git-changeset"] as const;

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

/**
 * Fetch one repo's remote state, then invalidate the cached overview so the
 * ahead/behind counts on screen are computed against what the fetch brought in.
 * Resolves with the outcome — including a refusal or a failure, which are
 * results rather than errors; rejects only when the request itself failed.
 */
export function useFetchRepo(): (repo: string) => Promise<FetchResult> {
  const queryClient = useQueryClient();
  return async (repo) => {
    const result = await fetchRepo(repo);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}

/**
 * Fetch every discovered repo in one request, then invalidate the cached
 * overview. Resolves with an outcome per repo, whatever mixture of updated,
 * refused, and failed they came back as.
 */
export function useFetchAllRepos(): () => Promise<FetchResult[]> {
  const queryClient = useQueryClient();
  return async () => {
    const results = await fetchAllRepos();
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return results;
  };
}

/**
 * Read what changed in one checkout, in one view. Computed by the server per
 * request, then cached until the changeset refresh clears it — nothing polls a
 * diff.
 */
export function useChangeset(path: string, view: ChangesetView): UseQueryResult<Changeset> {
  return useQuery({
    queryKey: [...changesetKey, "files", path, view],
    queryFn: () => fetchChangeset(path, view),
  });
}

/**
 * Read one file's patch in the same view, cached under its own key so a
 * changeset only ever loads the diffs actually opened. `previousPath` pairs the
 * two sides of a rename into one patch.
 */
export function useFilePatch(
  path: string,
  view: ChangesetView,
  file: string,
  previousPath: string | null,
): UseQueryResult<FilePatch> {
  return useQuery({
    queryKey: [...changesetKey, "patch", path, view, file, previousPath],
    queryFn: () => fetchFilePatch(path, view, file, previousPath ?? undefined),
  });
}

/**
 * A trigger that drops every cached changeset and patch, so the next read
 * recomputes them. The working tree moves under kiri without announcing itself,
 * and recomputing a diff is expensive enough that it stays an explicit ask
 * rather than something a scan sets off.
 */
export function useRefreshChangesets(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: changesetKey });
  };
}

/**
 * Fast-forward one checkout, then invalidate the cached overview. Resolves with
 * the outcome, including the reason a pull was refused.
 */
export function usePullCheckout(): (path: string) => Promise<PullResult> {
  const queryClient = useQueryClient();
  return async (path) => {
    const result = await pullCheckout(path);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}
