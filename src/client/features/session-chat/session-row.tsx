import type { SessionListEntry, SessionStatus } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";

// Session lifecycle mapped onto the shared status vocabulary: a running turn
// reads as "working", the resting state as "idle".
const SESSION_STATUS: Record<SessionStatus, StatusKind> = {
  idle: "idle",
  running: "working",
  failed: "failed",
  cancelled: "cancelled",
};

// Trim a `provider:model` id to the bare model name for the byline — dropping
// the provider prefix and any org path (`local:google/gemma-…` → `gemma-…`).
// The full id still shows in the session aside.
const shortModel = (model: string): string => {
  const afterProvider = model.slice(model.indexOf(":") + 1);
  return afterProvider.slice(afterProvider.lastIndexOf("/") + 1);
};

// Compact token total for the byline: 12345 → "12k", anything under 1000 as-is.
const formatTokens = (total: number): string =>
  total >= 1000 ? `${Math.round(total / 1000)}k` : `${total}`;

/**
 * One session in an activity feed. A gold ◆ flags it as a session at the left
 * edge, leading a status-led mono byline — status, model, relative start, and
 * the running token total once a turn has completed — whose order mirrors the
 * run row. Below sits the session's first user message in the display face (the
 * "human voice" only sessions carry), linking through to the chat; before a
 * message is sent the short id stands in. `now` is injectable so tests render
 * deterministic relative times; production omits it.
 */
export function SessionRow({ session, now }: { session: SessionListEntry; now?: Date }) {
  const status = SESSION_STATUS[session.status];
  return (
    <StatusBlock status={status}>
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className="text-accent text-xs">
          ◆
        </span>
        <Meta>
          <Status status={status} />
          <span>{shortModel(session.model)}</span>
          <span>{formatRelativeTime(session.startedAt, now)}</span>
          {session.totalTokens > 0 ? (
            <span className="tabular-nums">{formatTokens(session.totalTokens)} tok</span>
          ) : null}
        </Meta>
      </div>
      <div className="mt-1">
        <HeadlineLink href={`/sessions/${session.id}`}>
          {session.preview ?? session.id.slice(0, 8)}
        </HeadlineLink>
      </div>
    </StatusBlock>
  );
}
