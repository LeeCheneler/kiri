import { type ReactNode, useId } from "react";
import { Link } from "wouter";

/** One entry in a vertical nav: a label, a destination, and optional active/external flags. */
export type NavItem = {
  label: string;
  href: string;
  active?: boolean;
  external?: boolean;
};

/** A titled cluster of rows nested under a NavList's section heading. */
export type NavGroup = {
  heading: string;
  items: NavItem[];
};

const ROW_CLASS =
  "group relative block py-2 pl-4 no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1";

function NavRows({ items }: { items: NavItem[] }) {
  return (
    <ul>
      {items.map((item) => {
        const isExternal = item.external === true;
        const isActive = item.active === true && !isExternal;
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
              {item.label}
            </span>
          </>
        );
        return (
          <li key={item.href}>
            {isExternal ? (
              <a href={item.href} target="_blank" rel="noreferrer noopener" className={ROW_CLASS}>
                {inner}
              </a>
            ) : (
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={ROW_CLASS}
              >
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Titled vertical navigation for the side rail — an eyebrow `heading` over a
 * list of link rows. Each row carries an accent strip flush to its left edge
 * that lights up on hover or when the item is `active`, and a `font-display`
 * body that fades muted → ink → accent across rest, hover, and active states.
 *
 * `items` are `{ label, href, active?, external? }`. Internal links thread
 * through wouter and gain `aria-current="page"` when `active`; pass `external`
 * for outbound links, which open in a new tab with a safe `rel` and ignore
 * `active` (an outbound URL is never the current page).
 *
 * Pass `groups` for a nested rail — the larger section `heading` over titled
 * clusters (workflows bucketed by label, say). Any flat `items` render first,
 * then each group renders its rows beneath a smaller sub-heading. When both
 * `items` and `groups` are empty, `emptyState` renders in their place. Owns no
 * outer margin — stack instances with the caller's own spacing.
 */
export function NavList({
  heading,
  items,
  groups = [],
  emptyState,
}: {
  heading: string;
  items: NavItem[];
  groups?: NavGroup[];
  emptyState?: ReactNode;
}) {
  const headingId = useId();
  const isEmpty = items.length === 0 && groups.length === 0;
  return (
    <nav aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-3 font-mono text-sm tracking-widest text-ink-muted uppercase"
      >
        {heading}
      </h2>
      {isEmpty ? (
        emptyState
      ) : (
        <div className="space-y-6">
          {items.length > 0 && <NavRows items={items} />}
          {groups.map((group) => (
            <div key={group.heading}>
              <h3 className="mb-2 font-mono text-xs tracking-widest text-ink-muted uppercase">
                {group.heading}
              </h3>
              <NavRows items={group.items} />
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
