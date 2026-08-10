import { Link } from "wouter";
import { isExternalHref } from "../../client/design-system/utils/is-external-href.ts";

const FOOTER_LINK_CLASS =
  "font-mono text-xs text-ink-muted no-underline transition-colors duration-150 hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent";

function FooterLink({ href, children }: { href: string; children: string }) {
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={FOOTER_LINK_CLASS}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={FOOTER_LINK_CLASS}>
      {children}
    </Link>
  );
}

/**
 * Marketing-site footer: the wordmark, a one-line descriptor, and a quiet row
 * of links. Shared chrome across the site's pages.
 */
export function SiteFooter() {
  return (
    <footer className="border-rule border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <span className="font-display text-xl text-ink italic leading-none">kiri</span>
          <span className="ml-3 font-mono text-xs text-ink-faint">
            The AI workspace that writes things down — on your machine.
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <FooterLink href="/docs">Docs</FooterLink>
          <FooterLink href="https://github.com/LeeCheneler/kiri">GitHub</FooterLink>
        </nav>
      </div>
    </footer>
  );
}
