/**
 * Titlecase a hyphen-separated slug for display: split on `-`, uppercase tokens
 * of two or fewer characters (`pr` → `PR`), capitalise the first letter of
 * longer ones, and join with spaces (`financial-advisor` → `Financial Advisor`).
 * The single titlecasing site for slug-derived display names —
 * `resolveArticleName` routes through here. Pure and dependency-free so the
 * server and the client can both import it.
 */
export const humaniseSlug = (slug: string): string =>
  slug
    .split("-")
    .map((token) =>
      token.length === 0
        ? token
        : token.length <= 2
          ? token.toUpperCase()
          : token[0].toUpperCase() + token.slice(1),
    )
    .join(" ");
