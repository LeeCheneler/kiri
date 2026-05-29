import { Link } from "wouter";

/** One ancestor link in a breadcrumb trail. */
export type Crumb = {
  label: string;
  href: string;
};

const LINK_CLASS =
  "text-ink-muted no-underline transition-colors duration-150 hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

/**
 * Breadcrumb trail — the path from the root to the current page, as an ordered
 * list inside a labelled `<nav>`. `items` are the ancestor links (threaded
 * through wouter for client-side navigation); `current` is the page you are on,
 * rendered as plain text marked `aria-current="page"` rather than a link. A `/`
 * separator is inserted between entries, so callers never write it. Quiet
 * machine-layer chrome: mono, muted, and carrying no margin of its own.
 */
export function Breadcrumb({ items, current }: { items: Crumb[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center font-mono text-xs [&>li+li]:before:mx-2 [&>li+li]:before:text-ink-faint [&>li+li]:before:content-['/']">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className={LINK_CLASS}>
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <span aria-current="page" className="text-ink">
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}
