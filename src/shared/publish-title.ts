/**
 * Resolve a publish entry's display title. Returns the explicit `title`
 * when set; otherwise titlecases the hyphen-separated `name`
 * (`pr-digest` → `PR Digest`). Tokens of two or fewer characters are
 * uppercased (`pr` → `PR`); longer tokens get only their first letter
 * capitalised. The single titlecasing site — callers that need a
 * resolved title (DB write, UI fallback) go through here.
 *
 * Pure and dependency-free so both the server (schema, runner, API
 * projection) and the client (run detail rendering) can import it.
 */
export const resolvePublishTitle = (name: string, title?: string): string => {
  if (title !== undefined && title.length > 0) return title;
  return name
    .split("-")
    .map((token) =>
      token.length === 0
        ? token
        : token.length <= 2
          ? token.toUpperCase()
          : token[0].toUpperCase() + token.slice(1),
    )
    .join(" ");
};
