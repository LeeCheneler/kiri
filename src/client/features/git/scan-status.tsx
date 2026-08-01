import { useState } from "react";
import type { GitOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useRefreshGit } from "../../state/git.ts";

/**
 * How old the model on screen is, next to the action that renews it. The server
 * scans in the background and answers reads from what it last found, so what is
 * rendered can trail the disk — a commit made in a terminal reaches it only on
 * the next scan. Saying when it was read is more honest than letting it pass for
 * live, and refreshing forces a scan on demand.
 *
 * `overview` is the model being described, or undefined before the first read
 * lands, in which case only the refresh action shows. A failed refresh is
 * reported without disturbing what is already on screen.
 */
export function ScanStatus({ overview }: { overview: GitOverview | undefined }) {
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
      <div className="flex flex-wrap items-center gap-3">
        {overview ? (
          <p className="text-ink-muted text-xs" aria-live="polite">
            {overview.refreshing || !overview.scannedAt
              ? "Scanning…"
              : `Scanned ${formatRelativeTime(overview.scannedAt)}`}
          </p>
        ) : null}
        <Button onClick={onRefresh} pending={refreshing} pendingLabel="Refreshing…">
          Refresh
        </Button>
      </div>
      {errorMessage ? (
        <Notice tone="negative" announce="polite" title="Couldn't rescan the roots">
          {errorMessage}
        </Notice>
      ) : null}
    </div>
  );
}
