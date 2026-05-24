import type { ReactNode } from "react";
import { Link } from "wouter";

/**
 * Editorial "back to …" link used as the first element on detail pages
 * — small-caps mono in the muted ink, prefixed with a `←` glyph that
 * the component renders itself. Callers pass only the label text as
 * `children` (e.g. `all activity`, `back to run`). Wraps wouter's
 * `<Link>`, so internal navigation stays client-side.
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
    >
      ← {children}
    </Link>
  );
}
