import { humaniseSlug } from "./humanise-slug.ts";

/**
 * Resolve a publish entry's display name. Returns the explicit `name` when set;
 * otherwise humanises the hyphen-separated `slug` (`pr-digest` → `PR Digest`)
 * via {@link humaniseSlug}. Callers that need a resolved name (DB write, UI
 * fallback) go through here.
 *
 * Pure and dependency-free so both the server (schema, runner, API projection)
 * and the client (run detail rendering) can import it.
 */
export const resolveArticleName = (slug: string, name?: string): string => {
  if (name !== undefined && name.length > 0) return name;
  return humaniseSlug(slug);
};
