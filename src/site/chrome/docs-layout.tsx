import type { ReactNode } from "react";
import { DocsNavRail } from "./docs-nav-rail.tsx";
import { DocsToc } from "./docs-toc.tsx";
import { SiteFooter } from "./site-footer.tsx";
import { SiteHeader } from "./site-header.tsx";

/**
 * Documentation page frame: the shared site chrome wrapping a three-column
 * reading layout — the docs nav rail on the left, the page content in the
 * centre, and the in-page table of contents on the right. Both rails stick
 * while the content scrolls. Below `lg` the layout collapses to a single
 * column: the nav rail stacks above the content, and the in-page contents (the
 * right rail) is dropped, since the page is then a single scroll. The caller
 * renders the page body into `children`.
 */
export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[11rem_minmax(0,1fr)_13rem] lg:gap-12">
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
