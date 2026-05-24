import type { ReactNode } from "react";
import { Link } from "wouter";

const WRAPPER_CLASS =
  "group relative block py-2 pl-4 no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

/**
 * Side-rail navigation entry — the shared shape behind the workflows
 * nav, recently-published rail, and docs nav. A rule strip sits flush
 * to the left of each row and flips to the accent token on hover or
 * when `active`; the body is rendered in font-display ink that fades
 * between muted/ink/accent based on hover and active state.
 *
 * Internal links thread through wouter's `<Link>` and carry
 * `aria-current="page"` when `active`. Pass `external` for outbound
 * links — they render as a native anchor with `target="_blank"` and a
 * safe `rel`. `active` is meaningless on external links (an outbound
 * URL is never the current page) and is ignored there.
 *
 * `children` is permissive so callers can stack a title and a meta
 * sub-line in the same row.
 */
export function RailLink({
  href,
  active = false,
  external = false,
  children,
}: {
  href: string;
  active?: boolean;
  external?: boolean;
  children: ReactNode;
}) {
  const isActive = active && !external;
  const stripBg = isActive ? "bg-accent" : "bg-rule";
  const bodyState = isActive
    ? "text-ink group-hover:text-accent group-focus-visible:text-accent"
    : "text-ink-muted group-hover:text-ink group-focus-visible:text-ink";

  const inner = (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-0 w-0.5 transition-colors duration-150 group-hover:bg-accent ${stripBg}`}
      />
      <span
        className={`block font-display text-base leading-tight transition-colors duration-150 ${bodyState}`}
      >
        {children}
      </span>
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={WRAPPER_CLASS}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={WRAPPER_CLASS}>
      {inner}
    </Link>
  );
}
