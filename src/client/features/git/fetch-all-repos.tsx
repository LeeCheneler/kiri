import { useState } from "react";
import type { FetchResult } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useFetchAllRepos } from "../../state/git.ts";
import { FetchReport } from "./sync-outcome.tsx";

// The tally, with the empty categories left out — "12 repos fetched, 2 updated"
// says more than a row of zeroes does.
const summarise = (results: FetchResult[]): string => {
  const count = (status: FetchResult["status"]) =>
    results.filter((result) => result.status === status).length;
  const parts = [
    [count("updated"), "updated"],
    [count("up-to-date"), "already up to date"],
    [count("refused"), "refused"],
    [count("failed"), "failed"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
};

/**
 * Fetch every discovered repo at once, and account for what came back.
 *
 * One request rather than a job: the page shows a pending state until the whole
 * set settles, then reports each repo's outcome. Repos that were already up to
 * date are counted rather than listed — the answer worth reading is which repos
 * moved and which could not be reached, and a workspace of dozens would
 * otherwise bury both under a wall of nothing-happened.
 */
export function FetchAllRepos() {
  const fetchAll = useFetchAllRepos();
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<FetchResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onFetch = () => {
    setPending(true);
    setErrorMessage(null);
    fetchAll()
      .then(setResults)
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setPending(false));
  };

  const noteworthy = (results ?? []).filter((result) => result.status !== "up-to-date");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={onFetch} pending={pending} pendingLabel="Fetching…">
          Fetch all
        </Button>
        <p className="max-w-md font-mono text-ink-muted text-xs">
          Fetches every repo above, so the ahead and behind counts are measured against current
          remote state rather than whenever each was last fetched.
        </p>
      </div>
      {errorMessage ? (
        <Notice tone="negative" announce="polite" title="Couldn't fetch">
          {errorMessage}
        </Notice>
      ) : null}
      {results ? (
        <Notice
          tone={results.some((result) => result.status === "failed") ? "warning" : "informational"}
          announce="polite"
          title={`Fetched ${results.length} ${results.length === 1 ? "repo" : "repos"}`}
        >
          {summarise(results)}
        </Notice>
      ) : null}
      {noteworthy.length > 0 ? <FetchReport results={noteworthy} /> : null}
    </div>
  );
}
