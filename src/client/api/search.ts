import type { SearchResults } from "../../shared/api/search.ts";
import { apiFetch, json } from "./http.ts";

/**
 * Search articles, sessions, run summaries, and workflow definitions for `q`.
 * A blank `q` returns empty groups. Throws on non-2xx.
 */
export const fetchSearch = async (q: string): Promise<SearchResults> => {
  const params = new URLSearchParams({ q });
  return json<SearchResults>(await apiFetch(`/api/search?${params}`));
};
