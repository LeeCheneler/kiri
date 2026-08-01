import { useState } from "react";
import type { GitOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useRefreshGit } from "../../state/git.ts";

/**
 * How old the model on screen is. The server scans in the background and answers
 * reads from what it last found, so what is rendered can trail the disk — a
 * commit made in a terminal reaches it only on the next scan. Saying when it was
 * read is more honest than letting it pass for live, and every page reading the
 * overview says it whether or not it carries the action that renews it.
 *
 * `overview` is the model being described, or undefined before the first read
 * lands, in which case there is nothing to say yet. Padded to sit on the line of
 * the buttons it is grouped with.
 */
export function ScanFreshness({ overview }: { overview: GitOverview | undefined }) {
  if (!overview) return null;
  return (
    <p className="py-1.5 text-ink-muted text-xs" aria-live="polite">
      {overview.refreshing || !overview.scannedAt
        ? "Scanning…"
        : `Scanned ${formatRelativeTime(overview.scannedAt)}`}
    </p>
  );
}

/**
 * Rescan the configured roots — the escape hatch for everything a root watch
 * cannot see, such as a commit made in a terminal.
 *
 * **Workspace-wide, not repo-scoped**: it rescans every root, so it belongs on
 * the page whose scope matches — the repo listing — rather than on a page about
 * one repo, where it would read as a sibling of that repo's own actions while
 * meaning something much broader. A failed rescan is reported without disturbing
 * what is already on screen.
 */
export function RefreshGit() {
  const refresh = useRefreshGit();
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onRefresh = () => {
    setRefreshing(true);
    setErrorMessage(null);
    refresh()
      .catch((error: unknown) =>
        setErrorMessage(error instanceof Error ? error.message : "Try again."),
      )
      .finally(() => setRefreshing(false));
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <Button onClick={onRefresh} pending={refreshing} pendingLabel="Refreshing…">
        Refresh
      </Button>
      {errorMessage ? (
        <Notice tone="negative" announce="polite" title="Couldn't rescan the roots">
          {errorMessage}
        </Notice>
      ) : null}
    </div>
  );
}
