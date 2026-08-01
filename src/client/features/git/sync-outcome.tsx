import type { FetchResult, SyncStatus } from "../../api.ts";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";

// One vocabulary for both fetch and pull, so "refused" means the same thing
// wherever it is read: kiri declined and will say why, rather than git failing.
const STATUS_LABEL: Record<SyncStatus, string> = {
  updated: "updated",
  "up-to-date": "up to date",
  refused: "refused",
  failed: "failed",
};

const STATUS_TONE: Record<SyncStatus, TagTone> = {
  updated: "positive",
  "up-to-date": "neutral",
  refused: "caution",
  failed: "negative",
};

/** The status of one fetch or pull, as its shared tag. */
export function SyncTag({ status }: { status: SyncStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

// Whatever the outcome has to say for itself: why kiri refused, what git said
// when it failed, or what a fetch actually moved.
function Detail({ result }: { result: FetchResult }) {
  const detail = result.reason ?? result.error;
  if (detail === undefined) return null;
  return (
    <p
      className={`mt-1 whitespace-pre-wrap break-words font-mono text-xs ${
        result.error === undefined ? "text-ink-muted" : "text-status-failed"
      }`}
    >
      {detail}
    </p>
  );
}

/**
 * The fetches that did not succeed, one repo per entry: the repo's name, how it
 * went, and the reason it was refused or git's message when it failed. Fetches
 * that worked report as a count instead — a workspace of dozens is unreadable
 * enumerated, and the answer worth reading is which repos could not be reached.
 * Used for a single repo's fetch and for a fetch-all's spread, so both read the
 * same way.
 */
export function FetchReport({ results }: { results: FetchResult[] }) {
  return (
    <ul className="space-y-3">
      {results.map((result) => (
        <li key={result.repo}>
          <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
            {result.repo}
            <SyncTag status={result.status} />
          </p>
          <Detail result={result} />
        </li>
      ))}
    </ul>
  );
}
