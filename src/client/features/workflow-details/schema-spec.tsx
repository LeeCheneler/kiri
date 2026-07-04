import type { WorkflowArticleSummary, WorkflowStepSummary } from "../../api.ts";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { EntryConfig, stepTitle } from "./entry-config.tsx";

type SchemaItem = WorkflowStepSummary | WorkflowArticleSummary;

/**
 * One schema entry: a disclosure whose summary pairs a phase marker, the
 * entry's title, and its ref handle — a step's declared `id` or an article's
 * `slug` — when it has one; expanding reveals the entry's config.
 */
function SchemaRow({ marker, entry }: { marker: string; entry: SchemaItem }) {
  // Article summaries always carry a `slug`; steps never do, so it's the
  // reliable discriminant now that steps may also declare a `name`.
  const article = "slug" in entry ? entry : undefined;
  // The entry's ref handle: what `{ step: <id> }` / `{ article: <slug> }`
  // env refs point at.
  const handle = article ? article.slug : "id" in entry ? entry.id : undefined;
  return (
    <Disclosure
      summary={
        <div className="flex items-baseline gap-5">
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-muted">
            {marker}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-3">
            <span className="truncate font-mono text-sm text-ink">
              {article ? article.name : stepTitle(entry)}
            </span>
            {handle && <span className="shrink-0 font-mono text-xs text-ink-faint">{handle}</span>}
          </span>
        </div>
      }
    >
      <EntryConfig entry={entry} />
    </Disclosure>
  );
}

/**
 * The Schema tab: the workflow's pipeline as an ordered list of disclosures —
 * the steps in declared order, then the articles, then the summariser. Each row
 * collapses to its kind and title; expand it to read that entry's description,
 * inline source, and env. Workflows with no steps, articles, or summariser show
 * an empty state.
 */
export function SchemaSpec({
  steps,
  articles,
  summarize,
}: {
  steps: WorkflowStepSummary[];
  articles?: WorkflowArticleSummary[];
  summarize?: WorkflowStepSummary;
}) {
  const hasSchema = steps.length > 0 || (articles?.length ?? 0) > 0 || summarize !== undefined;
  if (!hasSchema) {
    return <EmptyState>this workflow declares no schema.</EmptyState>;
  }
  return (
    <div className="divide-y divide-rule">
      {steps.map((step, index) => (
        <SchemaRow
          key={`step-${index}-${"use" in step ? step.use : "sh" in step ? step.sh : step.llm.model}`}
          marker={`Step ${String(index + 1).padStart(2, "0")}`}
          entry={step}
        />
      ))}
      {articles?.map((entry, index) => (
        <SchemaRow
          key={`article-${entry.slug}`}
          marker={`Article ${String(index + 1).padStart(2, "0")}`}
          entry={entry}
        />
      ))}
      {summarize && <SchemaRow marker="Summariser" entry={summarize} />}
    </div>
  );
}
