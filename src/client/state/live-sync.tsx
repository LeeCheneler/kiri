import { useQueryClient } from "@tanstack/react-query";
import { KIRI_EVENT_TYPES } from "../../shared/api/events.ts";
import { useLiveEvent, useLiveReconnect } from "../events/live.tsx";
import { queryKeysFor } from "./invalidation.ts";
import { STATIC_KEY_ROOTS } from "./query-keys.ts";

/**
 * Bridge the live event bus to the query cache: every server event invalidates
 * the queries `queryKeysFor` names for it, mounted or not. A reconnect
 * invalidates everything an event could have changed, recovering whatever was
 * announced while the stream was down.
 */
export function useLiveInvalidation(): void {
  const queryClient = useQueryClient();

  useLiveEvent({
    on: KIRI_EVENT_TYPES,
    handler: (event) => {
      for (const queryKey of queryKeysFor(event)) void queryClient.invalidateQueries({ queryKey });
    },
  });

  useLiveReconnect(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => !STATIC_KEY_ROOTS.includes(String(query.queryKey[0])),
    });
  });
}

/**
 * Mounts `useLiveInvalidation`. Renders nothing. Place once at the app root,
 * inside both `<QueryClientProvider>` and `<LiveEventsProvider>`.
 */
export function LiveSync(): null {
  useLiveInvalidation();
  return null;
}
