import { useState } from "react";
import type { FetchResult } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useFetchAllRepos } from "../../state/git.ts";
import { FetchReport } from "./sync-outcome.tsx";

/**
 * Fetch every discovered repo at once.
 *
 * One request rather than a job: a pending state until the whole set settles,
 * and **nothing at all reported on success**. Whatever the fetches moved is
 * already on the cards below — ahead and behind, and upstreams gone are exactly
 * what they report — so a notice counting what happened would restate the list
 * it sits above.
 *
 * **The exception is anything that did not succeed.** A repo refused for having
 * no remote, or failed offline, looks identical in the list to one that worked,
 * since nothing changed either way — so a silence there is indistinguishable
 * from "already up to date", and the counts trusted afterwards are wrong for
 * that repo. Those are named with their reasons; in the ordinary case there is
 * no notification.
 */
export function FetchAllRepos() {
  const fetchAll = useFetchAllRepos();
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<FetchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onFetch = () => {
    setPending(true);
    setErrorMessage(null);
    fetchAll()
      .then((results) =>
        setFailures(
          results.filter((result) => result.status === "refused" || result.status === "failed"),
        ),
      )
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <Button onClick={onFetch} pending={pending} pendingLabel="Fetching…">
        Fetch all
      </Button>
      {errorMessage ? (
        <Notice tone="negative" announce="polite" title="Couldn't fetch">
          {errorMessage}
        </Notice>
      ) : null}
      {failures.length > 0 ? <FetchReport results={failures} /> : null}
    </div>
  );
}
