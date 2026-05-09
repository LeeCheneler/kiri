import type { ReactNode } from "react";
import { Link } from "wouter";

/**
 * Three-column page shell: a sticky left rail with the kiri wordmark
 * (and room for future nav), the route content in the centre with a
 * max-width tuned for legible single-column reading, and a sticky
 * right rail reserved for system-status / todos as those land. Below
 * the `lg` breakpoint the grid collapses to a single column.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-310 px-8 py-12 lg:py-16">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr_260px] lg:gap-12">
        <aside className="lg:sticky lg:top-16 lg:self-start">
          <h1 className="leading-none">
            <Link
              href="/"
              className="font-display text-4xl text-ink italic no-underline transition-colors duration-150 hover:text-accent"
            >
              kiri
            </Link>
          </h1>
        </aside>
        <main className="min-w-0 lg:max-w-160">{children}</main>
        <aside className="hidden lg:sticky lg:top-16 lg:block lg:self-start" aria-hidden="true" />
      </div>
    </div>
  );
}
