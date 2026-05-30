import { useRef } from "react";
import { useLocation } from "wouter";
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
 * Left-rail site navigation, laid out as a full-height column: the kiri
 * wordmark and the Home link sit at the top, the live workflows nav fills
 * the scrollable middle (it grows with the registry), and the
 * documentation nav and version footer pin to the bottom. The whole rail
 * is held back until the workflows query settles, then fades in at once;
 * a failed registry fetch still renders the rail (minus the workflows
 * nav) so navigation stays available.
 *
 * Renders the rail's content only — pages drop it into the page shell's
 * left slot, which owns the surrounding `<aside>`, its bounded height,
 * and sticky positioning.
 */
export function SiteNav() {
  const { data: workflows, isPending } = useWorkflows();
  const [location] = useLocation();
  const activeName = activeWorkflowName(location);

  // Fade the rail in only on a genuine first load. A later navigation
  // between different page components remounts the rail with the registry
  // already cached, so it renders instantly — replaying the fade then
  // reads as a reload/flash.
  const cachedOnMount = useRef(!isPending);

  const docItems: NavItem[] = [
    { label: "Managing kiri", href: "https://local.kiri.build/docs" },
    {
      label: "Design system",
      href: "/dev/design-system",
      active: location === "/dev/design-system",
    },
    { label: "GitHub", href: "https://github.com/LeeCheneler/kiri" },
  ];

  // Hold the rail until the registry settles, then fade the whole thing in.
  if (isPending) return null;

  const containerClass = cachedOnMount.current
    ? "flex h-full flex-col"
    : "flex h-full animate-[feed-row-in_320ms_ease-out] flex-col";

  return (
    <div className={containerClass}>
      <h1 className="font-display text-4xl text-ink italic leading-none">kiri</h1>
      <div className="my-6">
        <Rule />
      </div>
      <NavList items={[{ label: "Home", href: "/", active: location === "/" }]} />
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {workflows && <WorkflowsNav workflows={workflows} activeName={activeName} />}
      </div>
      <div className="my-6">
        <Rule />
      </div>
      <NavList heading="Documentation" items={docItems} />
      <VersionInfo />
    </div>
  );
}
