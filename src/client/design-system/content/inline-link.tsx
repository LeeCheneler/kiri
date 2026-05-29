import type { ReactNode } from "react";
import { Link } from "wouter";
import { isExternalHref } from "../utils/is-external-href.ts";

const LINK_CLASS =
  "text-accent underline decoration-1 decoration-accent-deep underline-offset-2 transition-colors duration-150 hover:text-ink hover:decoration-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent";

/**
 * A link set within a run of prose or chrome. Accent-coloured and
 * underlined so it reads as a link before any hover; the underline deepens
 * to ink on hover and focus. Internal hrefs thread through wouter's
 * `<Link>` for client-side navigation; an href that resolves off-app opens
 * in a new tab with a safe `rel` and a trailing ↗ to mark that it leaves the
 * app — detected from the href, not a flag. A fragment href (`#…`) threads
 * through `<Link>` like any internal href and renders the same in-page anchor.
 *
 * This is the in-flow link. Standalone navigation entries — the side rail,
 * a back link — carry their own affordances and are not this component.
 */
export function InlineLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>
        {children}{" "}
        <span aria-hidden="true" className="font-mono">
          ↗
        </span>
      </a>
    );
  }
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}
