import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useSessionChildren } from "../../state/sessions.ts";
import { SESSION_STATUS } from "./session-row.tsx";

/**
 * Live worker links and statuses. `activeOnly` hides settled workers in the
 * reference rail; the details panel keeps the full history. `now` fixes relative times in tests.
 */
export function SessionChildren({
  id,
  now,
  activeOnly = false,
}: {
  id: string;
  now?: Date;
  activeOnly?: boolean;
}) {
  const allChildren = useSessionChildren(id).data ?? [];
  const children = activeOnly
    ? allChildren.filter((child) => child.status === "running" || child.status === "waiting")
    : allChildren;
  if (children.length === 0) return null;
  return (
    <section>
      <Eyebrow tone="muted">{activeOnly ? "Active workers" : "Workers"}</Eyebrow>
      <ul className={activeOnly ? "mt-1.5 max-h-48 space-y-4 overflow-y-auto" : "mt-1.5 space-y-4"}>
        {children.map((child) => (
          <li key={child.id} className="space-y-1">
            {/* Details above the display face, like every listing row — and
                the status is what this list is scanned for. */}
            <Meta>
              <Status status={SESSION_STATUS[child.status]} />
              <span>{formatRelativeTime(child.lastActivityAt, now)}</span>
            </Meta>
            <div className="text-sm">
              <HeadlineLink href={`/sessions/${child.id}`}>
                {child.title ?? child.id.slice(0, 8)}
              </HeadlineLink>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
