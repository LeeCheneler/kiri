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

/**
 * One session in an activity feed, differentiated from run rows as a
 * conversation rather than an artifact record. An accent `session` kind marker
 * leads the mono byline — kind, status, model, the attached persona when one
 * is set, and relative start — so a session declares itself before the shared
 * status vocabulary takes over. Below, the session's first user message is set
 * as quoted speech: italic display face between accent quotation marks (the
 * "human voice" only sessions carry — run rows' headlines stay upright), the
 * whole line linking through to the chat. Before a message is sent the short
 * id stands in, unquoted and upright — only actual speech gets quote marks.
 * `now` is injectable so tests render deterministic relative times; production
 * omits it.
 */
export function SessionRow({ session, now }: { session: SessionListEntry; now?: Date }) {
  const status = SESSION_STATUS[session.status];
  return (
    <StatusBlock status={status}>
      <Meta>
        <span className="text-accent uppercase">session</span>
        <Status status={status} />
        <span>{shortModel(session.model)}</span>
        {session.persona ? <span>{session.persona}</span> : null}
        <span>{formatRelativeTime(session.startedAt, now)}</span>
      </Meta>
      {/* Same 16px scale as run rows' content so neither kind outweighs the
          other in the blended feed; the quoted italic voice differentiates. */}
      <div className="mt-1 text-base">
        <HeadlineLink href={`/sessions/${session.id}`}>
          {session.preview ? (
            <>
              <span aria-hidden="true" className="text-accent">
                “
              </span>
              <span className="italic">{session.preview}</span>
              <span aria-hidden="true" className="text-accent">
                ”
              </span>
            </>
          ) : (
            session.id.slice(0, 8)
          )}
        </HeadlineLink>
      </div>
    </StatusBlock>
  );
}
