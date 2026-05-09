import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { type WorkflowSummary, fetchWorkflows } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";
import { WorkflowsNav } from "./workflows-nav.tsx";

const WORKFLOW_PATH_PREFIX = "/workflows/";

const activeWorkflowName = (location: string): string | null => {
  if (!location.startsWith(WORKFLOW_PATH_PREFIX)) return null;
  try {
    return decodeURIComponent(location.slice(WORKFLOW_PATH_PREFIX.length));
  } catch {
    // Malformed escape sequence: fall back to the raw segment so the
    // route still resolves rather than crashing the shell.
    return location.slice(WORKFLOW_PATH_PREFIX.length);
  }
};

/**
 * Three-column page shell: a sticky left rail with the kiri wordmark and
 * the workflows nav, the route content in the centre with a max-width
 * tuned for legible single-column reading, and a sticky right rail
 * reserved for system-status / todos as those land. Below the `lg`
 * breakpoint the grid collapses to a single column.
 *
 * The shell owns the workflows fetch so the nav stays consistent across
 * routes; the nav stays hidden until the registry resolves so a brief
 * empty-state flash never shows on a populated repo.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [location] = useLocation();
  const tokenRef = useRef(0);

  const refetch = useCallback(() => {
    const token = ++tokenRef.current;
    fetchWorkflows()
      .then((all) => {
        if (tokenRef.current !== token) return;
        setWorkflows(all);
      })
      .catch(() => {
        // Side-nav is non-essential chrome; the dashboard and workflow
        // page surface fetch errors prominently. Hide the nav on failure
        // rather than show a misleading empty state.
      });
  }, []);

  useEffect(() => {
    refetch();
    return () => {
      tokenRef.current++;
    };
  }, [refetch]);

  useLiveSync({
    on: ["workflow.added", "workflow.updated", "workflow.removed"],
    refetch,
  });

  const activeName = activeWorkflowName(location);

  return (
    <div className="mx-auto min-h-screen max-w-310 px-8 py-12 lg:py-16">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr_260px] lg:gap-12">
        <aside className="lg:sticky lg:top-16 lg:self-start">
          <h1 className="leading-none">
            <Link
              href="/"
              className="font-display text-4xl text-ink italic no-underline transition-colors duration-150 hover:text-accent"
            >
              kiri
            </Link>
          </h1>
          {workflows !== null && (
            <div className="mt-10">
              <h2 className="mb-3 text-xs tracking-widest text-ink-muted uppercase">Workflows</h2>
              <WorkflowsNav workflows={workflows} activeName={activeName} />
            </div>
          )}
        </aside>
        <main className="min-w-0 lg:max-w-160">{children}</main>
        <aside className="hidden lg:sticky lg:top-16 lg:block lg:self-start" aria-hidden="true" />
      </div>
    </div>
  );
}
