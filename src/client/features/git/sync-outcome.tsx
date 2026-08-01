import type { FetchResult, PullResult, SyncStatus } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";
import { dirName } from "./worktree-state.ts";

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
function Detail({ result }: { result: FetchResult | PullResult }) {
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
 * What each pull did, one checkout per entry: how far it moved, or why it did
 * not. Kept apart from the rows the actions live on, because a checkout that
 * pulls successfully stops being behind and leaves that list — the account of
 * what happened has to outlive the row that caused it.
 */
export function PullReport({ results }: { results: PullResult[] }) {
  return (
    <ul className="space-y-3">
      {results.map((result) => (
        <li key={result.path}>
          <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
            {dirName(result.path)}
            <SyncTag status={result.status} />
            {result.status === "updated"
              ? `fast-forwarded ${result.commits} ${result.commits === 1 ? "commit" : "commits"}`
              : null}
          </p>
          <Detail result={result} />
        </li>
      ))}
    </ul>
  );
}

/**
 * What a fetch found, one repo per entry: the repo's name, how it went, and
 * either the reason it was refused, git's message when it failed, or git's own
 * report of the refs that moved. Used for a single repo's fetch and for the
 * spread of outcomes a fetch-all comes back with, so both read the same way.
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
          {result.updates.length > 0 ? (
            <div className="mt-2">
              <Eyebrow tone="muted">What moved</Eyebrow>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-ink-muted text-xs">
                {result.updates.join("\n")}
              </pre>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
