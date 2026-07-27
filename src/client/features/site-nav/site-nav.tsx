import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "../../design-system/actions/button.tsx";
import { Rule } from "../../design-system/content/rule.tsx";
import { type NavItem, NavList } from "../../design-system/navigation/nav-list.tsx";
import { Drawer } from "../../design-system/surfaces/drawer.tsx";
import { NewSessionButton } from "../session-chat/new-session-button.tsx";
import { VersionInfo } from "./version-info.tsx";

// The rail's body — the primary nav and the new-session action up top, the
// documentation nav and version footer pinned to the foot — shared between the
// lg+ column and the mobile drawer.
function RailContent({ location }: { location: string }) {
  const docItems: NavItem[] = [
    { label: "Managing kiri", href: "https://kiri.build/docs" },
    {
      label: "Design system",
      href: "/dev/design-system",
      active: location === "/dev/design-system",
    },
    { label: "GitHub", href: "https://github.com/LeeCheneler/kiri" },
  ];

  return (
    <>
      <NavList
        items={[
          { label: "Activity", href: "/", active: location === "/" },
          { label: "Workflows", href: "/workflows", active: location.startsWith("/workflows") },
          { label: "Worktrees", href: "/worktrees", active: location.startsWith("/worktrees") },
          { label: "Tools & MCP", href: "/mcp", active: location.startsWith("/mcp") },
        ]}
      />
      <div className="mt-4">
        <NewSessionButton />
      </div>
      <div className="mt-auto">
        <div className="my-6">
          <Rule />
        </div>
        <NavList heading="Documentation" items={docItems} />
        <VersionInfo />
      </div>
    </>
  );
}

/**
 * Left-rail site navigation. At `lg` and up it is a full-height column: the
 * kiri wordmark sits at the top, the primary nav and the new-session action
 * below it, and the documentation nav and version footer
 * pinned to the bottom. Below `lg` the column collapses to a slim top bar — the
 * wordmark and a menu button — and the same rail content moves into a
 * left-anchored drawer the button opens; selecting a link, Escape, or a
 * backdrop click closes it.
 *
 * Renders the rail's content only — pages drop it into the page shell's left
 * slot, which owns the surrounding `<aside>`, its bounded height, and sticky
 * positioning.
 */
export function SiteNav() {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer whenever the route changes, so a tapped link doesn't leave
  // it hanging open over the page it navigated to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: location is the change trigger to re-run on, not a value the body reads.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <>
      <div className="flex h-full flex-col">
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
            <RailContent location={location} />
          </div>
        </div>
      </div>
      {menuOpen && (
        <Drawer title="Navigation" onClose={() => setMenuOpen(false)}>
          <RailContent location={location} />
        </Drawer>
      )}
    </>
  );
}
