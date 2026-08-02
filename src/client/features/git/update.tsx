import { useState } from "react";
import type { FetchResult, PullResult, UpdateResult } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { SyncFailure } from "./sync-outcome.tsx";
import { dirName } from "./worktree-state.ts";

/** What one repo's update could not do, for the card that reports it. */
export interface RepoUpdateFailure {
  /** The repo's own fetch, when that is what did not succeed; null otherwise. */
  fetch: FetchResult | null;
  /** The checkouts of it that could not be brought current. */
  checkouts: PullResult[];
}

/** Everything the last update could not do, keyed by repo name. */
export type UpdateReport = ReadonlyMap<string, RepoUpdateFailure>;

const NOTHING_TO_REPORT: UpdateReport = new Map();

const stalled = (result: { status: string }): boolean =>
  result.status === "refused" || result.status === "failed";

/**
 * Only what did not happen. An update that worked has nothing to say — whatever
 * it moved is already in the ahead and behind counts on screen — while a repo
 * that could not be reached, or a checkout that could not be fast-forwarded,
 * looks exactly like one that was already current unless it says so.
 */
const reportOf = (results: UpdateResult[]): UpdateReport => {
  const report = new Map<string, RepoUpdateFailure>();
  for (const result of results) {
    const failure: RepoUpdateFailure = {
      fetch: stalled(result.fetch) ? result.fetch : null,
      checkouts: result.checkouts.filter(stalled),
    };
    if (failure.fetch !== null || failure.checkouts.length > 0) report.set(result.repo, failure);
  }
  return report;
};

/** An update in flight, what it reported, and the trigger that runs it again. */
export interface Update {
  start: () => void;
  pending: boolean;
  /** A request that never reached the server — not an outcome it reported. */
  errorMessage: string | null;
  report: UpdateReport;
}

/**
 * Drive an update and hold what it could not do, for the cards that report it.
 * The report replaces the last one wholesale, so a repo that has since updated
 * stops saying anything rather than accumulating history.
 */
export function useUpdate(run: () => Promise<UpdateResult[]>): Update {
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<UpdateReport>(NOTHING_TO_REPORT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const start = () => {
    setPending(true);
    setErrorMessage(null);
    run()
      .then((results) => setReport(reportOf(results)))
      .catch((error: unknown) => {
        setReport(NOTHING_TO_REPORT);
        setErrorMessage(error instanceof Error ? error.message : "Try again.");
      })
      .finally(() => setPending(false));
  };

  return { start, pending, errorMessage, report };
}

/**
 * The update itself: `git fetch --prune` for the repo, then a fast-forward of
 * every checkout of it that can take one.
 *
 * **Always offered**, never conditional on anything looking out of date: ahead
 * and behind are measured against remote-tracking refs, so there is no way to
 * know a checkout is behind until a fetch has happened, and gating the update on
 * that would be circular — a repo that has never fetched is exactly the case
 * that needs it most.
 *
 * **Nothing is reported on success.** What an update moved shows up in the
 * ahead/behind counts and gone upstreams the page already renders, and the
 * pending state is the feedback while it runs. Only a request that never reached
 * the server is reported here; everything the update itself could not do is
 * reported on the card it belongs to.
 */
export function UpdateAction({ label, update }: { label: string; update: Update }) {
  return (
    <div className="flex flex-col items-end gap-3">
      <Button onClick={update.start} pending={update.pending} pendingLabel="Updating…">
        {label}
      </Button>
      {update.errorMessage === null ? null : (
        <Notice tone="negative" announce="polite" title="Couldn't update">
          {update.errorMessage}
        </Notice>
      )}
    </div>
  );
}

/**
 * What one repo's update could not do, for the repo's card on the listing: the
 * repo itself when the fetch never landed, then each checkout that could not be
 * brought current, named by its directory so the card says which one. Renders
 * nothing when the repo has nothing to report, which is the ordinary case.
 */
export function RepoUpdateReport({ failure }: { failure: RepoUpdateFailure | undefined }) {
  if (failure === undefined) return null;
  return (
    <ul className="mt-3 space-y-2">
      {failure.fetch === null ? null : (
        <li>
          <SyncFailure result={failure.fetch} />
        </li>
      )}
      {failure.checkouts.map((checkout) => (
        <li key={checkout.path} className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-ink text-sm">{dirName(checkout.path)}</span>
          <SyncFailure result={checkout} />
        </li>
      ))}
    </ul>
  );
}
