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

/**
 * One session in an activity feed, edged with its status colour. Leads with the
 * session's first user message as its identifier — falling back to the short id
 * before one is sent — which carries the link through to the session, above a
 * mono byline of status, model, and relative start time. `now` is injectable so
 * tests render deterministic relative times; production omits it.
 */
export function SessionRow({ session, now }: { session: SessionListEntry; now?: Date }) {
  const status = SESSION_STATUS[session.status];
  return (
    <StatusBlock status={status}>
      <HeadlineLink href={`/sessions/${session.id}`}>
        {session.preview ?? session.id.slice(0, 8)}
      </HeadlineLink>
      <div className="mt-1">
        <Meta>
          <Status status={status} />
          <span>{session.model}</span>
          <span>{formatRelativeTime(session.startedAt, now)}</span>
        </Meta>
      </div>
    </StatusBlock>
  );
}
