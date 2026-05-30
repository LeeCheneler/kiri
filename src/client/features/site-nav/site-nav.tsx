import { Link, useLocation } from "wouter";
import { Rule } from "../../design-system/content/rule.tsx";
import { type NavItem, NavList } from "../../design-system/navigation/nav-list.tsx";
import { useWorkflows } from "../../state/workflows.ts";
import { VersionInfo } from "./version-info.tsx";
import { WorkflowsNav } from "./workflows-nav.tsx";

const WORKFLOW_PATH_PREFIX = "/workflows/";

const activeWorkflowName = (location: string): string | null => {
  if (!location.startsWith(WORKFLOW_PATH_PREFIX)) return null;
  try {
    return decodeURIComponent(location.slice(WORKFLOW_PATH_PREFIX.length));
  } catch {
    // Malformed escape sequence: fall back to the raw segment so the rail
    // still resolves rather than crashing.
    return location.slice(WORKFLOW_PATH_PREFIX.length);
  }
};

/**
 * Left-rail site navigation: the kiri wordmark, the live workflows nav, a
 * documentation nav, and the version footer, each divided by a hairline
 * rule. The workflows nav reads the registry from the query cache (kept
 * live as definitions change) and stays hidden until the first fetch
 * resolves so a populated repo never flashes an empty state; the
 * documentation nav always renders, so the rail stays useful even when
 * the registry fetch fails.
 *
 * Renders the rail's content only — pages drop it into the page shell's
 * left slot, which owns the surrounding `<aside>` and sticky positioning.
 */
export function SiteNav() {
  const { data: workflows } = useWorkflows();
  const [location] = useLocation();
  const activeName = activeWorkflowName(location);

  const docItems: NavItem[] = [
    { label: "Managing kiri", href: "https://local.kiri.build/docs" },
    {
      label: "Design system",
      href: "/dev/design-system",
      active: location === "/dev/design-system",
    },
    { label: "GitHub", href: "https://github.com/LeeCheneler/kiri" },
  ];

  return (
    <>
      <h1 className="leading-none">
        <Link
          href="/"
          className="font-display text-4xl text-ink italic no-underline transition-colors duration-150 hover:text-accent"
        >
          kiri
        </Link>
      </h1>
      {workflows && (
        <>
          <div className="my-6">
            <Rule />
          </div>
          <WorkflowsNav workflows={workflows} activeName={activeName} />
        </>
      )}
      <div className="my-6">
        <Rule />
      </div>
      <NavList heading="Documentation" items={docItems} />
      <VersionInfo />
    </>
  );
}
