import type { GitOverview } from "../../api.ts";
import { formatRelativeTime } from "../../formatters/format-time.ts";

/**
 * How old the model on screen is. The server scans in the background and answers
 * reads from what it last found, so what is rendered can trail the disk — a
 * commit made in a terminal reaches it only on the next scan. Saying when it was
 * read is more honest than letting it pass for live. It is a readout and not an
 * action: an update rescans as part of settling, so the page is renewed by the
 * thing that made it stale rather than by a second button meaning almost the
 * same.
 *
 * `overview` is the model being described, or undefined before the first read
 * lands, in which case there is nothing to say yet. Padded to sit on the line of
 * the action it is grouped with.
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
