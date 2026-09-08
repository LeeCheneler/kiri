import { useLocation } from "wouter";
import { Disclosure } from "../../client/design-system/content/disclosure.tsx";
import { type NavGroup, NavList } from "../../client/design-system/navigation/nav-list.tsx";
import { DOCS_PAGES, docsHref } from "../docs/docs-nav.ts";

/**
 * Docs left-rail navigation: the documentation table of contents rendered as a
 * vertical nav, with pages clustered under their section headings and the
 * current page marked active. Reads the active page from the router location
 * so it tracks client-side navigation.
 */
export function DocsNavRail() {
  const [location] = useLocation();
  const groups: NavGroup[] = [];
  for (const page of DOCS_PAGES) {
    const href = docsHref(page.slug);
    const item = { label: page.title, href, active: location === href };
    const last = groups.at(-1);
    if (last?.heading === page.section) {
      last.items.push(item);
    } else {
      groups.push({ heading: page.section, items: [item] });
    }
  }
  const current = DOCS_PAGES.find((page) => docsHref(page.slug) === location);
  return (
    <>
      <div className="hidden lg:block">
        <NavList heading="Documentation" items={groups} />
      </div>
      <div className="border border-rule lg:hidden">
        <Disclosure
          key={location}
          summary={
            <span className="font-mono text-sm text-ink">Docs · {current?.title ?? "Browse"}</span>
          }
        >
          <NavList heading="Documentation" items={groups} />
        </Disclosure>
      </div>
    </>
  );
}
