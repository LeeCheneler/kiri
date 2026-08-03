import type { WorkflowSummary } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useWorkflowRunWindow } from "../../state/runs.ts";
import { RunWorkflow } from "../run-workflow/run-workflow.tsx";

/**
 * One workflow in the catalogue: a compact row naming the workflow (linking to
 * its detail page) with the status and relative time of its most recent run (or
 * "never run") alongside, its description beneath, and the launch control at the
 * row's end. The group is carried by the catalogue's section heading, not
 * repeated here. The last-run readout reads the live single-row run window, so
 * it tracks new runs without a reload. `now` is injectable so tests render
 * deterministic relative times.
 */
export function WorkflowRow({ workflow, now }: { workflow: WorkflowSummary; now?: Date }) {
  const window = useWorkflowRunWindow(workflow.name, 1);
  const lastRun = window.data?.[0];

  return (
    <div className="flex items-center gap-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-xl">
            <HeadlineLink href={`/workflows/${encodeURIComponent(workflow.name)}`}>
              {workflow.name}
            </HeadlineLink>
          </span>
          <Meta>
            {lastRun ? (
              <>
                <Status status={lastRun.status} />
                <span>{formatRelativeTime(lastRun.startedAt, now)}</span>
              </>
            ) : (
              <span>never run</span>
            )}
          </Meta>
        </div>
        {workflow.description ? (
          <p className="mt-1 font-display text-ink-muted italic leading-snug">
            {workflow.description}
          </p>
        ) : null}
      </div>
      <RunWorkflow workflow={workflow} size="sm" />
    </div>
  );
}
