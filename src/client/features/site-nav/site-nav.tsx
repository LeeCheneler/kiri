import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { WorkflowSummary } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Rule } from "../../design-system/content/rule.tsx";
import { type NavItem, NavList } from "../../design-system/navigation/nav-list.tsx";
import { Drawer } from "../../design-system/surfaces/drawer.tsx";
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

// The rail's body — the Home row, the live workflows nav, the documentation
// nav, and the version footer — shared between the lg+ column and the mobile
// drawer. A fragment, so each host supplies the bounded-height flex column the
// scrollable workflows middle needs.
function RailContent({
  workflows,
  activeName,
  location,
}: {
  workflows: WorkflowSummary[] | undefined;
  activeName: string | null;
  location: string;
}) {
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
      <NavList items={[{ label: "Home", href: "/", active: location === "/" }]} />
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {workflows && <WorkflowsNav workflows={workflows} activeName={activeName} />}
      </div>
      <div className="my-6">
        <Rule />
      </div>
      <NavList heading="Documentation" items={docItems} />
      <VersionInfo />
    </>
  );
}

/**
 * Left-rail site navigation. At `lg` and up it is a full-height column: the
 * kiri wordmark sits at the top, the live workflows nav fills the scrollable
 * middle (it grows with the registry), and the documentation nav and version
 * footer pin to the bottom. Below `lg` the column collapses to a slim top bar —
 * the wordmark and a menu button — and the same rail content moves into a
 * left-anchored drawer the button opens; selecting a link, Escape, or a
 * backdrop click closes it.
 *
 * The whole rail is held back until the workflows query settles, then fades in
 * at once; a later navigation remounts it with the registry already cached, so
 * the fade is suppressed to avoid reading as a reload/flash. A failed registry
 * fetch still renders the rail (minus the workflows nav) so navigation stays
 * available.
 *
 * Renders the rail's content only — pages drop it into the page shell's left
 * slot, which owns the surrounding `<aside>`, its bounded height, and sticky
 * positioning.
 */
export function SiteNav() {
  const { data: workflows, isPending } = useWorkflows();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeName = activeWorkflowName(location);

  // Fade the rail in only on a genuine first load. A later navigation between
  // different page components remounts the rail with the registry already
  // cached, so it renders instantly — replaying the fade then reads as a
  // reload/flash.
  const cachedOnMount = useRef(!isPending);

  // Close the drawer whenever the route changes, so a tapped link doesn't leave
  // it hanging open over the page it navigated to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: location is the change trigger to re-run on, not a value the body reads.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  // Hold the rail until the registry settles, then fade the whole thing in.
  if (isPending) return null;

  const fade = cachedOnMount.current ? "" : "animate-[feed-row-in_320ms_ease-out]";

  return (
    <>
      <div className={`flex h-full flex-col ${fade}`}>
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-4xl text-ink italic leading-none">kiri</h1>
          <div className="lg:hidden">
            <Button onClick={() => setMenuOpen(true)} title="Open navigation">
              menu
            </Button>
          </div>
        </div>
        <div className="mt-6 hidden min-h-0 flex-1 flex-col lg:flex">
          <Rule />
          <div className="mt-6 flex min-h-0 flex-1 flex-col">
            <RailContent workflows={workflows} activeName={activeName} location={location} />
          </div>
        </div>
      </div>
      {menuOpen && (
        <Drawer title="Navigation" onClose={() => setMenuOpen(false)}>
          <RailContent workflows={workflows} activeName={activeName} location={location} />
        </Drawer>
      )}
    </>
  );
}
