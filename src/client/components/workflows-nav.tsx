import type { WorkflowSummary } from "../api.ts";
import { Code } from "../design-system/content/code.tsx";
import { EmptyState } from "../design-system/content/empty-state.tsx";
import { type NavGroup, type NavItem, NavList } from "../design-system/navigation/nav-list.tsx";

const toItem = (workflow: WorkflowSummary, activeName: string | null): NavItem => ({
  label: workflow.name,
  href: `/workflows/${encodeURIComponent(workflow.name)}`,
  active: workflow.name === activeName,
});

/**
 * Split workflows into an ungrouped list and named groups. Ungrouped workflows
 * keep the registry's order; groups are sorted alphabetically by label
 * (case-insensitive) and keep registry order within each group.
 */
const partition = (
  workflows: WorkflowSummary[],
  activeName: string | null,
): { items: NavItem[]; groups: NavGroup[] } => {
  const items: NavItem[] = [];
  const byGroup = new Map<string, NavItem[]>();
  for (const workflow of workflows) {
    const item = toItem(workflow, activeName);
    if (!workflow.group) {
      items.push(item);
      continue;
    }
    const existing = byGroup.get(workflow.group);
    if (existing) {
      existing.push(item);
    } else {
      byGroup.set(workflow.group, [item]);
    }
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([heading, groupItems]) => ({ heading, items: groupItems }));
  return { items, groups };
};

/**
 * Workflows nav for the page shell's left rail. Workflows that declare a
 * `group` are bucketed under that label; ungrouped workflows list flat above
 * the groups, and the active row picks up the accent strip and ink colour.
 * When the registry is empty, a single italic sentence points at `kiri init`
 * and `workflows/` so a fresh clone never shows blank navigation.
 */
export function WorkflowsNav({
  workflows,
  activeName,
}: {
  workflows: WorkflowSummary[];
  activeName: string | null;
}) {
  const { items, groups } = partition(workflows, activeName);
  return (
    <NavList
      heading="Workflows"
      items={items}
      groups={groups}
      emptyState={
        <EmptyState>
          no workflows yet. run <Code>kiri init</Code> and add YAML to <Code>workflows/</Code>.
        </EmptyState>
      }
    />
  );
}
