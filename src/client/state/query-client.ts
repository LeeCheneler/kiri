import { QueryClient } from "@tanstack/react-query";

/**
 * Build the app's query client. Freshness is driven by the SSE event bus
 * (see `<LiveSync>`), not by focus, polling, or remounts — so the
 * automatic refetch triggers are off and a query stays cached until an
 * event invalidates it. Failures surface immediately rather than after
 * retries, matching kiri's single-shot loopback fetches.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  });
}
