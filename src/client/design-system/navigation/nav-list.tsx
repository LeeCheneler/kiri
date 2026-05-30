import { type ReactNode, useId } from "react";
import { Link } from "wouter";
import { isExternalHref } from "../utils/is-external-href.ts";

/** One link row in a nav list. Whether it leaves the app is inferred from `href`. */
export type NavItem = {
  label: string;
  href: string;
  active?: boolean;
};

/** A titled cluster of rows within a nav list. */
export type NavGroup = {
  heading: string;
  items: NavItem[];
};

/** A nav list entry: either a single row or a titled group of rows. */
export type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry;

const ROW_CLASS =
  "group relative block py-2 pl-4 no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

function Item({ label, href, active = false }: NavItem) {
  const external = isExternalHref(href);
  const isActive = active && !external;
  const stripBg = isActive ? "bg-accent" : "bg-rule";
  const bodyState = isActive
    ? "text-ink group-hover:text-accent group-focus-visible:text-accent"
    : "text-ink-muted group-hover:text-ink group-focus-visible:text-ink";
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-0 w-0.5 transition-colors duration-150 group-hover:bg-accent ${stripBg}`}
      />
      <span
        className={`block font-display text-sm leading-tight transition-colors duration-150 ${bodyState}`}
      >
        {label}
        {external && (
          <span aria-hidden="true" className="font-mono">
            {" "}
            ↗
          </span>
        )}
      </span>
    </>
  );
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className={ROW_CLASS}>
          {body}
        </a>
      ) : (
        <Link href={href} aria-current={isActive ? "page" : undefined} className={ROW_CLASS}>
          {body}
        </Link>
      )}
    </li>
  );
}

function Group({ heading, items }: NavGroup) {
  return (
    <li className="mt-6">
      <h3 className="mb-2 font-mono text-xs tracking-widest text-ink-muted uppercase">{heading}</h3>
      <ul>
        {items.map((item) => (
          <Item key={item.href} {...item} />
        ))}
      </ul>
    </li>
  );
}

/**
 * Titled vertical navigation for the side rail — an eyebrow `heading` over a
 * column of link rows. Each row carries an accent strip flush to its left edge
 * that lights up on hover or when the item is `active`, and a `font-display`
 * body that fades muted → ink → accent across rest, hover, and active states.
 *
 * `items` is an ordered mix of rows and groups, rendered in that order. A row
 * is `{ label, href, active? }`; a group is `{ heading, items }` — a titled
 * cluster beneath a smaller sub-heading. Consecutive rows sit tight; a group
 * stands off with a little space above it. A row links internally through
 * wouter and gains `aria-current="page"` when `active`; a row whose `href`
 * points off-app (a different origin, or the hosted `/docs` site) instead opens
 * in a new tab with a safe `rel` and a trailing ↗, and is never current —
 * there's no flag to set, it's read from the href.
 *
 * Pass `heading` for a labelled `<nav>` landmark — the usual side-rail section.
 * Omit it for a bare cluster of rows with no landmark and no eyebrow, e.g. a
 * lone primary link the caller places. When `items` is empty, `emptyState`
 * renders in its place. Owns no outer margin — stack instances with the
 * caller's own spacing.
 */
export function NavList({
  heading,
  items,
  emptyState,
}: {
  heading?: string;
  items: NavEntry[];
  emptyState?: ReactNode;
}) {
  const headingId = useId();
  const body =
    items.length === 0 ? (
      emptyState
    ) : (
      <ul className="[&>li:first-child]:mt-0">
        {items.map((entry) =>
          isGroup(entry) ? (
            <Group key={entry.heading} {...entry} />
          ) : (
            <Item key={entry.href} {...entry} />
          ),
        )}
      </ul>
    );

  if (heading === undefined) {
    return <>{body}</>;
  }

  return (
    <nav aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-3 font-mono text-sm tracking-widest text-ink-muted uppercase"
      >
        {heading}
      </h2>
      {body}
    </nav>
  );
}
