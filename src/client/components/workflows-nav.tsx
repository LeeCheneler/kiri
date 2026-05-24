import type { WorkflowSummary } from "../api.ts";
import { EmptyState } from "./ui/empty-state.tsx";
import { RailLink } from "./ui/rail-link.tsx";

/**
 * Workflows nav for the page shell's left rail. Each entry is a Link to
 * `/workflows/:name` with the name set in Fraunces; the active row picks
 * up the accent strip and ink colour, inactive rows stay muted with a
 * neutral rule strip. Empty state is a single italic sentence pointing
 * at `kiri init` and `workflows/` so a fresh clone never shows blank
 * navigation.
 */
export function WorkflowsNav({
  workflows,
  activeName,
}: {
  workflows: WorkflowSummary[];
  activeName: string | null;
}) {
  if (workflows.length === 0) {
    return (
      <EmptyState>
        no workflows yet. run{" "}
        <code className="font-mono text-xs not-italic text-ink">kiri init</code> and add YAML to{" "}
        <code className="font-mono text-xs not-italic text-ink">workflows/</code>.
      </EmptyState>
    );
  }
  return (
    <nav aria-label="workflows">
      <ul>
        {workflows.map((workflow) => (
          <li key={workflow.name}>
            <RailLink
              href={`/workflows/${encodeURIComponent(workflow.name)}`}
              active={workflow.name === activeName}
            >
              {workflow.name}
            </RailLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
