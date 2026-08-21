import type { SessionListEntry, SessionStatus } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { ArticleList } from "../activity-feed/article-list.tsx";

// Session lifecycle mapped onto the shared status vocabulary: a running turn
// reads as "working", the resting state as "idle", a turn paused on tool
// approval as "waiting". Shared with the aside's workers list, which reads
// child sessions in the same vocabulary.
export const SESSION_STATUS: Record<SessionStatus, StatusKind> = {
  idle: "idle",
  running: "working",
  waiting: "waiting",
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
 * leads the mono byline — kind, status, model, and relative start — so a
 * session declares itself before the shared status vocabulary takes over. A
 * project session names its project in the byline too, linked inline like a
 * run row's workflow — the byline is the machine layer, so a destination link
 * in the display face would read as the row's headline rather than as
 * metadata. Below, the session's first user message is set
 * as quoted speech: italic display face between accent quotation marks (the
 * "human voice" only sessions carry — run rows' headlines stay upright), the
 * whole line linking through to the chat. Any articles the session wrote
 * follow in an indented block, set apart from that headline so the row reads
 * as one conversation and its output rather than as peer titles. A titled
 * session leads with its title instead, upright and unquoted — a title names
 * the conversation rather than voicing it. Before a title or message exists the short id stands in,
 * likewise unquoted — only actual speech gets quote marks.
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
        {/* A delegated child paused on tool approval — blocked on the user —
            badged so it is visible from the listing without opening the chat. */}
        {session.hasWaitingChild ? <Status status="waiting">worker waiting</Status> : null}
        {session.projectName !== null && session.projectId !== null ? (
          // Wrapped so Meta's middot attaches to the span rather than
          // joining the link's underline and hit area, as run rows do.
          <span>
            <InlineLink href={`/projects/${encodeURIComponent(session.projectId)}`}>
              {session.projectName}
            </InlineLink>
          </span>
        ) : null}
        <span>{shortModel(session.model)}</span>
        <span>{formatRelativeTime(session.startedAt, now)}</span>
      </Meta>
      {/* Same 16px scale as run rows' content so neither kind outweighs the
          other in the blended feed; the quoted italic voice differentiates. */}
      <div className="mt-1 text-base">
        <HeadlineLink href={`/sessions/${session.id}`}>
          {session.title ? (
            session.title
          ) : session.preview ? (
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
      <ArticleList
        articles={session.articles}
        hrefFor={(article) => `/sessions/${session.id}/articles/${article.slug}`}
      />
    </StatusBlock>
  );
}
