import { Button } from "../../design-system/actions/button.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { useWaitingSessions } from "../../state/sessions.ts";

/** Home marginalia linking to sessions and workers blocked on a permission decision. */
export function NeedsAttentionPanel() {
  const { data, isPending, isError, refetch } = useWaitingSessions();
  return (
    <section aria-label="Needs attention" className="space-y-4">
      <Eyebrow tone="muted">Needs attention</Eyebrow>
      {isPending ? <LoadingState>Checking for permissions…</LoadingState> : null}
      {isError ? (
        <div className="space-y-2">
          <Notice tone="warning" title="Could not refresh attention items" announce="polite">
            The list may be out of date.
          </Notice>
          <Button variant="dismissive" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {!isPending && !isError && data?.length === 0 ? (
        <EmptyState>Nothing needs your attention.</EmptyState>
      ) : null}
      {data && data.length > 0 ? (
        <ul className="max-h-[calc(100dvh-8rem)] space-y-5 overflow-y-auto break-words">
          {data.map((session) => (
            <li key={session.id} className="space-y-1.5">
              <Meta>
                <Status status="waiting">Permission needed</Status>
                {session.parentSessionId ? <span>Worker</span> : null}
              </Meta>
              <div className="text-lg">
                <HeadlineLink href={`/sessions/${encodeURIComponent(session.id)}`}>
                  {session.label}
                </HeadlineLink>
              </div>
              {session.projectName ? (
                <p className="font-mono text-xs text-ink-muted">{session.projectName}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
