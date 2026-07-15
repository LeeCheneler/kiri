import { type UseQueryResult, keepPreviousData, useQuery } from "@tanstack/react-query";
import { type SearchResults, fetchSearch } from "../api.ts";

/** Query key for one search term. */
export const searchKey = (q: string) => ["search", q] as const;

/**
 * Query the cross-entity search endpoint for `q`, disabled while `q` is
 * blank. The previous term's results stand in as placeholder data while a
 * new term is in flight, so the list never flashes empty between
 * keystrokes. `staleTime: 0` overrides the app's SSE-driven Infinity
 * default: no live event invalidates a search term, so re-entering one must
 * re-query the index rather than pin its first answer forever.
 */
export function useSearch(q: string): UseQueryResult<SearchResults, Error> {
  return useQuery({
    queryKey: searchKey(q),
    queryFn: () => fetchSearch(q),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}
