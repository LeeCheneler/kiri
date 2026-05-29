import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { type WorkflowSummary, fetchWorkflows } from "../api.ts";
import { Rule } from "../design-system/content/rule.tsx";
import { type NavItem, NavList } from "../design-system/navigation/nav-list.tsx";
import { useLiveSync } from "../events/live.tsx";
import { VersionInfo } from "./version-info.tsx";
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
 * Three-column page shell: a sticky left rail with the kiri wordmark,
 * the workflows nav, a documentation nav, and the version footer, each
 * divided by a hairline rule; the route content in the centre with a
 * max-width tuned for legible single-column reading; and a sticky right
 * rail whose contents the caller supplies via `rightAside`. Below the
 * `lg` breakpoint the grid collapses to a single column.
 *
 * `rightAside` is the per-route marginalia slot — the home page
 * passes `<RecentlyPublished>`, the article route passes its
 * `<ArticleAside>` TOC, and other routes pass nothing. When omitted the
 * right column renders empty so the centre column keeps a stable width
 * across routes.
 *
 * The shell owns the workflows fetch so the nav stays consistent across
 * routes; the workflows nav stays hidden until the registry resolves so
 * a brief empty-state flash never shows on a populated repo. The
 * documentation nav always renders so the rail still surfaces something
 * useful when the workflows fetch fails.
 */
export function PageShell({
  children,
  rightAside,
}: {
  children: ReactNode;
  rightAside?: ReactNode;
}) {
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
        // Side-nav is non-essential chrome; the home and workflow
        // pages surface fetch errors prominently. Hide the nav on failure
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

  const docItems: NavItem[] = [
    { label: "Managing kiri", href: "https://local.kiri.build/docs", external: true },
    {
      label: "Design system",
      href: "/dev/design-system",
      active: location === "/dev/design-system",
    },
    { label: "GitHub", href: "https://github.com/LeeCheneler/kiri", external: true },
    { label: "Releases", href: "https://github.com/LeeCheneler/kiri/releases", external: true },
  ];

  return (
    <div className="mx-auto min-h-screen max-w-420 px-8 py-12 lg:py-16">
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
            <>
              <div className="mt-10 mb-6">
                <Rule />
              </div>
              <WorkflowsNav workflows={workflows} activeName={activeName} />
            </>
          )}
          <div className="mt-10 mb-6">
            <Rule />
          </div>
          <NavList heading="Documentation" items={docItems} />
          <VersionInfo />
        </aside>
        <main className="min-w-0 lg:max-w-240">{children}</main>
        <aside className="hidden lg:sticky lg:top-16 lg:block lg:self-start">{rightAside}</aside>
      </div>
    </div>
  );
}
