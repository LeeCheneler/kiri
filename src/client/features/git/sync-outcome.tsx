import type { SyncStatus } from "../../api.ts";
import { Tag, type TagTone } from "../../design-system/content/tag.tsx";

// One vocabulary for a repo's fetch and a checkout's fast-forward alike, so
// "refused" means the same thing wherever it is read: kiri declined and will say
// why, rather than git failing.
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

/** The status of one fetch or fast-forward, as its shared tag. */
export function SyncTag({ status }: { status: SyncStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

/** An outcome that did not happen: how it went, and what it had to say for itself. */
export interface SyncOutcome {
  status: SyncStatus;
  /** Why kiri declined; present only on a refusal. */
  reason?: string;
  /** Git's message; present only on a failure. */
  error?: string;
}

/**
 * One outcome that did not happen, inline: its status, and either kiri's reason
 * for declining or git's own message. Sits inside the card of whatever it
 * concerns — a repo on the listing, a checkout on a repo's page — so a reason is
 * never read apart from the thing it is about.
 */
export function SyncFailure({ result }: { result: SyncOutcome }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <SyncTag status={result.status} />
      <span
        className={`whitespace-pre-wrap break-words font-mono text-xs ${
          result.error === undefined ? "text-ink-muted" : "text-status-failed"
        }`}
      >
        {result.reason ?? result.error}
      </span>
    </span>
  );
}
