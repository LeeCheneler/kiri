import type { WorkflowPublishSummary, WorkflowStepSummary } from "../../api.ts";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { EntryConfig, stepKind, stepTitle } from "./entry-config.tsx";

type SchemaItem = WorkflowStepSummary | WorkflowPublishSummary;

/**
 * One schema entry: a disclosure whose summary pairs a phase marker, the entry's
 * kind, and its title; expanding reveals the entry's config.
 */
function SchemaRow({ marker, entry }: { marker: string; entry: SchemaItem }) {
  // Publish summaries always carry a resolved `title`; steps never do, so it's
  // the reliable discriminant now that steps may also declare a `name`.
  const publish = "title" in entry ? entry : undefined;
  return (
    <Disclosure
      summary={
        <div className="flex items-baseline gap-5">
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-muted">
            {marker}
          </span>
          <span className="shrink-0 font-mono text-xs text-ink-faint uppercase">
            {stepKind(entry)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
            {publish ? publish.title : stepTitle(entry)}
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {publish && (
          <div className="flex flex-col gap-1">
            <h4 className="font-display text-xl text-ink leading-tight">{publish.title}</h4>
            <span className="font-mono text-xs text-ink-faint">{publish.name}</span>
          </div>
        )}
        <EntryConfig entry={entry} />
      </div>
    </Disclosure>
  );
}

/**
 * The Schema tab: the workflow's pipeline as an ordered list of disclosures —
 * the steps in declared order, then the publishes, then the summariser. Each row
 * collapses to its kind and title; expand it to read that entry's description,
 * inline source, and env. Workflows with no steps, publishes, or summariser show
 * an empty state.
 */
export function SchemaSpec({
  steps,
  publish,
  summarize,
}: {
  steps: WorkflowStepSummary[];
  publish?: WorkflowPublishSummary[];
  summarize?: WorkflowStepSummary;
}) {
  const hasSchema = steps.length > 0 || (publish?.length ?? 0) > 0 || summarize !== undefined;
  if (!hasSchema) {
    return <EmptyState>this workflow declares no schema.</EmptyState>;
  }
  return (
    <div className="divide-y divide-rule">
      {steps.map((step, index) => (
        <SchemaRow
          key={`step-${index}-${"use" in step ? step.use : step.sh}`}
          marker={`Step ${String(index + 1).padStart(2, "0")}`}
          entry={step}
        />
      ))}
      {publish?.map((entry, index) => (
        <SchemaRow
          key={`publish-${entry.name}`}
          marker={`Publish ${String(index + 1).padStart(2, "0")}`}
          entry={entry}
        />
      ))}
      {summarize && <SchemaRow marker="Summariser" entry={summarize} />}
    </div>
  );
}
