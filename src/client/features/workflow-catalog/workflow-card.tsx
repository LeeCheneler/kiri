import type { WorkflowSummary } from "../../api.ts";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { Card } from "../../design-system/surfaces/card.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useWorkflowRunWindow } from "../../state/runs.ts";
import { RunWorkflow } from "../run-workflow/run-workflow.tsx";

/**
 * One workflow in the catalogue: a bordered card naming the workflow (linking to
 * its detail page) with its description, the status and relative time of its most
 * recent run (or "never run"), and the launch control. The group is carried by
 * the catalogue's section heading, not repeated here. The last-run readout reads
 * the live single-row run window, so it tracks new runs without a reload. `now`
 * is injectable so tests render deterministic relative times.
 */
export function WorkflowCard({ workflow, now }: { workflow: WorkflowSummary; now?: Date }) {
  const window = useWorkflowRunWindow(workflow.name, 1);
  const lastRun = window.data?.[0];

  return (
    <Card>
      {/* Full-height column so the launch control pins to the card's foot
          (mt-auto) and aligns across a row of unequal-length descriptions. */}
      <div className="flex h-full flex-col">
        <div className="text-2xl">
          <HeadlineLink href={`/workflows/${encodeURIComponent(workflow.name)}`}>
            {workflow.name}
          </HeadlineLink>
        </div>
        {workflow.description ? (
          <p className="mt-2 font-display text-ink-muted italic leading-snug">
            {workflow.description}
          </p>
        ) : null}
        <div className="mt-4">
          {lastRun ? (
            <Meta>
              <Status status={lastRun.status} />
              <span>{formatRelativeTime(lastRun.startedAt, now)}</span>
            </Meta>
          ) : (
            <Meta>
              <span>never run</span>
            </Meta>
          )}
        </div>
        <div className="mt-auto flex justify-end pt-5">
          <RunWorkflow workflow={workflow} />
        </div>
      </div>
    </Card>
  );
}
