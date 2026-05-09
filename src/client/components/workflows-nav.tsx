import { Link } from "wouter";
import type { WorkflowSummary } from "../api.ts";

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
      <p className="font-display text-sm leading-snug text-ink-muted italic">
        no workflows yet. run{" "}
        <code className="font-mono text-xs not-italic text-ink">kiri init</code> and add YAML to{" "}
        <code className="font-mono text-xs not-italic text-ink">workflows/</code>.
      </p>
    );
  }
  return (
    <nav aria-label="workflows">
      <ul>
        {workflows.map((workflow) => {
          const active = workflow.name === activeName;
          return (
            <li key={workflow.name}>
              <Link
                href={`/workflows/${encodeURIComponent(workflow.name)}`}
                aria-current={active ? "page" : undefined}
                className="group relative block py-2 pl-4 no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-1 left-0 w-0.5 transition-colors duration-150 group-hover:bg-accent ${active ? "bg-accent" : "bg-rule"}`}
                />
                <span
                  className={`font-display text-base leading-tight transition-colors duration-150 group-hover:text-ink ${active ? "text-ink" : "text-ink-muted"}`}
                >
                  {workflow.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
