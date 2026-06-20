import { Link } from "wouter";
import { isExternalHref } from "../../client/design-system/utils/is-external-href.ts";

const NAV_LINK_CLASS =
  "font-mono text-sm text-ink-muted no-underline transition-colors duration-150 hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent";

function NavLink({ href, children }: { href: string; children: string }) {
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={NAV_LINK_CLASS}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={NAV_LINK_CLASS}>
      {children}
    </Link>
  );
}

/**
 * Marketing-site top bar: the italic kiri wordmark linking home, and a quiet
 * horizontal nav. Shared chrome across the site's pages.
 */
export function SiteHeader() {
  return (
    <header className="border-rule border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 sm:px-8">
        <Link href="/" className="font-display text-2xl text-ink italic leading-none no-underline">
          kiri
        </Link>
        <nav className="flex items-center gap-7">
          <NavLink href="/docs">Docs</NavLink>
          <NavLink href="https://github.com/LeeCheneler/kiri">GitHub</NavLink>
        </nav>
      </div>
    </header>
  );
}
