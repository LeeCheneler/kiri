import { useLocation } from "wouter";
import { type NavItem, NavList } from "../../client/design-system/navigation/nav-list.tsx";
import { DOCS_PAGES, docsHref } from "../docs/docs-nav.ts";

/**
 * Docs left-rail navigation: the documentation table of contents rendered as a
 * vertical nav, with the current page marked active. Reads the active page from
 * the router location so it tracks client-side navigation.
 */
export function DocsNavRail() {
  const [location] = useLocation();
  const items: NavItem[] = DOCS_PAGES.map((page) => {
    const href = docsHref(page.slug);
    return { label: page.title, href, active: location === href };
  });
  return <NavList heading="Documentation" items={items} />;
}
