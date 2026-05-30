import type { ReactNode } from "react";

/**
 * Three-column page layout: a sticky left rail, the route content in the
 * centre at a width tuned for legible single-column reading, and a sticky
 * right rail for marginalia. All three columns hold their width across
 * routes so the centre never shifts; `left` and `right` render empty when
 * a route supplies no rail content. Below the `lg` breakpoint the grid
 * collapses to a single column — the left rail stacks above the content
 * and the right rail is hidden.
 *
 * Purely presentational: callers compose the rails (the site nav on the
 * left, per-route marginalia on the right) and pass them in. Each page
 * renders the shell itself, so each owns its own rails.
 */
export function PageShell({
  left,
  right,
  children,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-420 px-8 py-12 lg:py-16">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr_260px] lg:gap-12">
        <aside className="lg:sticky lg:top-16 lg:h-[calc(100dvh-8rem)] lg:self-start">{left}</aside>
        <main className="min-w-0 lg:max-w-240">{children}</main>
        <aside className="hidden lg:sticky lg:top-16 lg:block lg:self-start">{right}</aside>
      </div>
    </div>
  );
}
