import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useSessionChildren } from "../../state/sessions.ts";
import { SESSION_STATUS } from "./session-row.tsx";

/**
 * The session's delegated workers, listed beside the chat: each child's title
 * linking through to its own page, with its live status (a child paused on
 * tool approval reads as waiting, distinct from the working pulse and the
 * settled states) and when it last moved — so a finished or blocked worker is
 * spottable without scrolling back through the transcript. Deliberately spare:
 * two lines per worker, so a busy session's list stays glanceable; the child's
 * own page carries everything else. Hidden entirely while the session has
 * delegated nothing. Live like the rest of the rail: the children query
 * refetches on session events. `now` is injectable so tests render
 * deterministic relative times.
 */
export function SessionChildren({ id, now }: { id: string; now?: Date }) {
  const children = useSessionChildren(id).data ?? [];
  if (children.length === 0) return null;
  return (
    <section>
      <Eyebrow tone="muted">Workers</Eyebrow>
      <ul className="mt-1.5 space-y-4">
        {children.map((child) => (
          <li key={child.id} className="space-y-1">
            <div className="text-sm">
              <HeadlineLink href={`/sessions/${child.id}`}>
                {child.title ?? child.id.slice(0, 8)}
              </HeadlineLink>
            </div>
            <Meta>
              <Status status={SESSION_STATUS[child.status]} />
              <span>{formatRelativeTime(child.lastActivityAt, now)}</span>
            </Meta>
          </li>
        ))}
      </ul>
    </section>
  );
}
