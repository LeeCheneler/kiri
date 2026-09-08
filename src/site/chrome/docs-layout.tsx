import type { ReactNode } from "react";
import { DocsNavRail } from "./docs-nav-rail.tsx";
import { DocsToc } from "./docs-toc.tsx";
import { SiteFooter } from "./site-footer.tsx";
import { SiteHeader } from "./site-header.tsx";

/**
 * Documentation page frame: the shared site chrome wrapping a three-column
 * reading layout — the docs nav rail on the left, the page content in the
 * centre, and the in-page table of contents on the right. Both rails stick
 * while the content scrolls. Below `lg`, navigation collapses above the article and the in-page contents
 * are hidden to leave room for reading. The caller
 * renders the page body into `children`.
 */
export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 sm:px-8 lg:py-12">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)_11rem] lg:gap-8">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <DocsNavRail />
          </aside>
          <main className="min-w-0">{children}</main>
          <aside className="hidden lg:sticky lg:top-8 lg:block lg:self-start">
            <DocsToc />
          </aside>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
