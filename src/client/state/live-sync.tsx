import { useActivityFeedLive } from "./activity.ts";
import { useRecentArticlesLive } from "./articles.ts";
import { useRunFeedsLive, useRunWindowsLive, useRunsLive } from "./runs.ts";
import { useSessionsLive } from "./sessions.ts";
import { useWorkflowsLive } from "./workflows.ts";

/**
 * Bridges the live event bus to the query cache: mounts each resource's
 * live-sync hook so server events invalidate the queries they affect.
 * Renders nothing. Place once at the app root, inside both
 * `<QueryClientProvider>` and `<LiveEventsProvider>`.
 */
export function LiveSync(): null {
  useRunsLive();
  useRunWindowsLive();
  useRunFeedsLive();
  useActivityFeedLive();
  useRecentArticlesLive();
  useWorkflowsLive();
  useSessionsLive();
  return null;
}
