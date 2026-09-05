import type { ReactNode } from "react";

/**
 * Three-column page layout: a sticky left rail, the route content in the
 * centre at a width tuned for legible single-column reading, and a sticky
 * right rail for marginalia. The left and centre hold their width across
 * routes so the centre never shifts; the right rail renders only when a
 * route supplies content for it. Below the `lg` breakpoint the grid
 * collapses to a single column — the left slot stacks above the content
 * (the site nav collapses itself to a top bar there) and the right rail
 * stacks below it, so its marginalia stays reachable on narrow screens
 * rather than being dropped.
 *
 * Purely presentational: callers compose the rails (the site nav on the
 * left, per-route marginalia on the right) and pass them in. Each page
 * renders the shell itself, so each owns its own rails.
 *
 * `wide` is for content-dense routes (e.g. a card grid) that have no
 * marginalia: it drops the reserved right-rail track and the centre's
 * reading-width cap so the content spans the full width. Pass it without
 * `right`.
 */
export function PageShell({
  left,
  right,
  wide = false,
  children,
}: {
  left?: ReactNode;
  right?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen max-w-420 px-8 py-6 lg:py-8">
      <div
        className={`grid grid-cols-1 gap-8 lg:gap-12 ${wide ? "lg:grid-cols-[200px_1fr]" : "lg:grid-cols-[200px_1fr_260px]"}`}
      >
        {/* Sticky positioning makes the rail its own stacking context, so it is
            raised above the centre column: a rail control's popup (the theme
            picker) must paint over the content's own sticky chrome. */}
        <aside className="lg:sticky lg:top-8 lg:z-20 lg:h-[calc(100dvh-4rem)] lg:self-start">
          {left}
        </aside>
        <main className={wide ? "min-w-0" : "min-w-0 lg:max-w-240"}>{children}</main>
        {right ? <aside className="lg:sticky lg:top-8 lg:self-start">{right}</aside> : null}
      </div>
    </div>
  );
}
