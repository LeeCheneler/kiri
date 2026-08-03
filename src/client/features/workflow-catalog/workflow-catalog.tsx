import { useState } from "react";
import type { WorkflowSummary } from "../../api.ts";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Code } from "../../design-system/content/code.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useWorkflows } from "../../state/workflows.ts";
import { WorkflowRow } from "./workflow-row.tsx";

type Group = { heading: string; workflows: WorkflowSummary[] };

// Substring filter across name, description, and group (case-insensitive). An
// empty query passes everything.
const filterWorkflows = (workflows: WorkflowSummary[], query: string): WorkflowSummary[] => {
  const q = query.trim().toLowerCase();
  if (q === "") return workflows;
  return workflows.filter(
    (workflow) =>
      workflow.name.toLowerCase().includes(q) ||
      (workflow.description?.toLowerCase().includes(q) ?? false) ||
      (workflow.group?.toLowerCase().includes(q) ?? false),
  );
};

// Split into an ungrouped list (registry order) and named groups (alphabetical,
// registry order within) — the same shape the side-nav uses.
const partition = (
  workflows: WorkflowSummary[],
): { ungrouped: WorkflowSummary[]; groups: Group[] } => {
  const ungrouped: WorkflowSummary[] = [];
  const byGroup = new Map<string, WorkflowSummary[]>();
  for (const workflow of workflows) {
    if (!workflow.group) {
      ungrouped.push(workflow);
      continue;
    }
    const existing = byGroup.get(workflow.group);
    if (existing) existing.push(workflow);
    else byGroup.set(workflow.group, [workflow]);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([heading, grouped]) => ({ heading, workflows: grouped }));
  return { ungrouped, groups };
};

function RowList({ workflows, now }: { workflows: WorkflowSummary[]; now?: Date }) {
  return (
    <div className="divide-y divide-rule">
      {workflows.map((workflow) => (
        <WorkflowRow key={workflow.name} workflow={workflow} now={now} />
      ))}
    </div>
  );
}

/**
 * The workflow catalogue: a searchable, grouped list of every registered
 * workflow, each a launchable row. Ungrouped workflows lead; named groups
 * follow under their heading. The filter matches name, description, and group.
 * Reads the live workflows registry, so additions and removals reflect without
 * a reload. `now` is injectable so tests render deterministic relative times.
 */
export function WorkflowCatalog({ now }: { now?: Date }) {
  const workflows = useWorkflows();
  const [query, setQuery] = useState("");

  return (
    <section>
      <Breadcrumb items={[]} current="Workflows" />
      <div className="mt-6 max-w-sm">
        <TextInput value={query} onChange={setQuery} placeholder="Filter workflows…" />
      </div>
      <div className="mt-8">
        <Body workflows={workflows} query={query} now={now} />
      </div>
    </section>
  );
}

function Body({
  workflows,
  query,
  now,
}: {
  workflows: ReturnType<typeof useWorkflows>;
  query: string;
  now?: Date;
}) {
  if (workflows.isPending) return <LoadingState>Loading workflows…</LoadingState>;
  if (workflows.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load workflows: {workflows.error.message}
      </p>
    );
  }

  if (workflows.data.length === 0) {
    return (
      <EmptyState>
        no workflows yet. run <Code>kiri init</Code> and add YAML to <Code>workflows/</Code>.
      </EmptyState>
    );
  }

  const matched = filterWorkflows(workflows.data, query);
  if (matched.length === 0) {
    return <EmptyState>No workflows match “{query.trim()}”.</EmptyState>;
  }

  const { ungrouped, groups } = partition(matched);
  return (
    <div className="space-y-8">
      {ungrouped.length > 0 ? <RowList workflows={ungrouped} now={now} /> : null}
      {groups.map((group) => (
        <section key={group.heading}>
          <Eyebrow>{group.heading}</Eyebrow>
          <div className="mt-1">
            <RowList workflows={group.workflows} now={now} />
          </div>
        </section>
      ))}
    </div>
  );
}
