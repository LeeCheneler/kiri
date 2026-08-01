import { useState } from "react";
import type { FetchResult, RepoOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useFetchRepo } from "../../state/git.ts";
import { FetchReport } from "./sync-outcome.tsx";

/**
 * Ask this repo's remote what is new, with when it last did beside it.
 *
 * **Always offered**, never conditional on anything looking out of date: ahead
 * and behind are measured against remote-tracking refs, so there is no way to
 * know a checkout is behind until a fetch has happened, and gating the fetch on
 * that would be circular — a repo that has never fetched is exactly the case
 * that needs it most. One fetch covers every checkout in the repo, since its
 * worktrees share an object store, so it is a repo-level action.
 *
 * **Nothing is reported on success.** Whatever a fetch moved shows up in the
 * ahead/behind counts and gone upstreams the page already renders, and the
 * pending state is the feedback while it runs. The one thing that cannot go
 * unsaid is a fetch that did not succeed: a refused or failed repo looks
 * identical to one that worked — nothing changed either way — so it is named
 * with its reason rather than passing for "already up to date".
 */
export function FetchRepo({ repo }: { repo: RepoOverview }) {
  const fetchRepo = useFetchRepo();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FetchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onFetch = () => {
    setPending(true);
    setErrorMessage(null);
    fetchRepo(repo.name)
      .then((result) =>
        setFailure(result.status === "refused" || result.status === "failed" ? result : null),
      )
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-ink-muted text-xs" aria-live="polite">
          {repo.lastFetchedAt === null
            ? "Never fetched"
            : `Fetched ${formatRelativeTime(repo.lastFetchedAt)}`}
        </p>
        <Button onClick={onFetch} pending={pending} pendingLabel="Fetching…">
          Fetch
        </Button>
      </div>
      {errorMessage ? (
        <Notice tone="negative" announce="polite" title="Couldn't fetch">
          {errorMessage}
        </Notice>
      ) : null}
      {failure ? <FetchReport results={[failure]} /> : null}
    </div>
  );
}
