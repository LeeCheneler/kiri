import type { ReactNode } from "react";
import { Link } from "wouter";
import { isExternalHref } from "../utils/is-external-href.ts";

const LINK_CLASS =
  "group font-display leading-tight text-ink no-underline outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

// The arrow flows inline immediately after the text (no whitespace before it),
// so when the headline wraps it stays glued to the last word instead of floating
// off to the column edge. `inline-block` keeps the hover/focus nudge transform
// applying; `ml-2` is the visual gap and, being a margin, adds no break point.
const ARROW_CLASS =
  "ml-2 inline-block font-mono text-ink-muted transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-accent group-focus-visible:translate-x-0.5 group-focus-visible:text-accent";

/**
 * A standalone link to a destination — the title of a thing you click through
 * to, not a word inside a sentence. Set in the display face and ink-coloured
 * (so it reads as a heading at rest, never as loud chrome), it carries a
 * trailing arrow that tints accent and nudges along on hover and focus; the
 * text tints accent to match. Inherits its font-size from the surrounding
 * element, so the caller picks the scale.
 *
 * Internal hrefs thread through wouter's `<Link>` for client-side navigation
 * and trail a `→`; an href that resolves off-app opens in a new tab with a safe
 * `rel` and trails a `↗` instead — detected from the href, not a flag.
 *
 * This is the destination link. Links woven into a run of prose are `InlineLink`
 * instead; side-rail navigation carries its own affordance.
 */
export function HeadlineLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>
        {children}
        <span aria-hidden="true" className={ARROW_CLASS}>
          ↗
        </span>
      </a>
    );
  }
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
      <span aria-hidden="true" className={ARROW_CLASS}>
        →
      </span>
    </Link>
  );
}
