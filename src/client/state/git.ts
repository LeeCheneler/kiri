import { type UseQueryResult, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type Changeset,
  type ChangesetView,
  type CreateWorktreeResult,
  type FilePatch,
  type GitOverview,
  type PruneWorktreesResult,
  type RemoveWorktreeResult,
  type UpdateResult,
  createWorktree,
  fetchChangeset,
  fetchFilePatch,
  fetchGitOverview,
  pruneWorktrees,
  removeWorktree,
  updateAllRepos,
  updateRepo,
} from "../api.ts";
import { useLiveSync } from "../events/live.tsx";
import { type Limiter, createLimiter } from "./limit-concurrency.ts";

const gitKey = ["git"] as const;

// Diffs are computed per request rather than read from the overview snapshot,
// so they cache under a root of their own. Keeping them out of `gitKey` means an
// operation invalidating the overview — an update, a worktree change —
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
 * Bring one repo up to date — fetch it, then fast-forward every checkout of it
 * that can take one — and invalidate the cached overview, so the ahead/behind
 * counts on screen are computed against what the update brought in. Resolves
 * with the outcome, including a refusal or a failure, which are results rather
 * than errors; rejects only when the request itself failed.
 */
export function useUpdateRepo(): (repo: string) => Promise<UpdateResult> {
  const queryClient = useQueryClient();
  return async (repo) => {
    const result = await updateRepo(repo);
    void queryClient.invalidateQueries({ queryKey: gitKey });
    return result;
  };
}

/**
 * Update every discovered repo in one request, then invalidate the cached
 * overview. Resolves with an outcome per repo, whatever mixture of updated,
 * refused, and failed they came back as.
 */
export function useUpdateAllRepos(): () => Promise<UpdateResult[]> {
  const queryClient = useQueryClient();
  return async () => {
    const results = await updateAllRepos();
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
 * How many file patches are read at once. Each one is a git process on the
 * server, and browsers cap connections to a host at around six anyway — a higher
 * number would only queue in the browser while handing the server the whole
 * changeset to compute simultaneously.
 */
export const PATCH_CONCURRENCY = 4;

/**
 * Read a patch per file, in the same view, each cached under its own key. Reads
 * run {@link PATCH_CONCURRENCY} at a time in the order given, so a changeset of
 * hundreds of files arrives steadily from the top rather than as one burst.
 * `previousPath` pairs the two sides of a rename into one patch.
 *
 * The queue belongs to the mounted caller, so leaving the page abandons whatever
 * it had not started rather than making the next page wait behind it.
 */
export function usePatchLimiter(): Limiter {
  return useMemo(() => createLimiter(PATCH_CONCURRENCY), []);
}

/**
 * Read one file's patch in the given view, cached under its own key, waiting its
 * turn at `limit`. `previousPath` pairs the two sides of a rename into one
 * patch. The read starts when the hook mounts, so a caller that mounts it only
 * for the diffs on screen pays only for those.
 */
export function useFilePatch(
  path: string,
  view: ChangesetView,
  file: string,
  previousPath: string | null,
  limit: Limiter,
): UseQueryResult<FilePatch> {
  return useQuery({
    queryKey: [...changesetKey, "patch", path, view, file, previousPath],
    queryFn: () => limit(() => fetchFilePatch(path, view, file, previousPath ?? undefined)),
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
