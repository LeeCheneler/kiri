import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import type { ActivityEntry } from "../../api.ts";
import { type TabDef, Tabs } from "../../design-system/navigation/tabs.tsx";
import { useActivityFeed } from "../../state/activity.ts";
import { useRunFeed } from "../../state/runs.ts";
import { useSessionsFeed } from "../../state/sessions.ts";
import { Feed, type FeedState } from "./feed.tsx";

// Normalise an infinite feed query into the shape `Feed` renders, mapping its
// rows to tagged activity entries. Keeps the three view wrappers to one line each.
function toState<T>(
  feed: UseInfiniteQueryResult<T[], Error>,
  toEntries: (rows: T[]) => ActivityEntry[],
): FeedState {
  return {
    isPending: feed.isPending,
    isError: feed.isError,
    error: feed.error,
    entries: feed.data ? toEntries(feed.data) : [],
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    fetchNextPage: () => void feed.fetchNextPage(),
  };
}

function AllFeed({ now }: { now?: Date }) {
  const state = toState(useActivityFeed(), (entries) => entries);
  return <Feed state={state} noun="activity" now={now} />;
}

function RunsFeed({ now }: { now?: Date }) {
  const state = toState(useRunFeed(), (runs) => runs.map((run) => ({ kind: "run", run })));
  return <Feed state={state} noun="runs" now={now} />;
}

function SessionsFeed({ now }: { now?: Date }) {
  const state = toState(useSessionsFeed(), (sessions) =>
    sessions.map((session) => ({ kind: "session", session })),
  );
  return <Feed state={state} noun="sessions" now={now} />;
}

/**
 * The home activity feed: a deep-linkable `All · Runs · Sessions` tab strip
 * over one of three reverse-chronological feeds. `All` is the union of runs
 * and sessions; `Runs` and `Sessions` are each kind on its own. The tabs name
 * the events they list, not the definitions behind them — the workflow
 * catalogue in the nav is a separate surface. The active view lives in the
 * `?view=` search param (defaulting to `All`); only the active panel mounts,
 * so just its query runs. `now` is injectable for deterministic tests;
 * production omits it.
 */
export function ActivityFeed({ now }: { now?: Date }) {
  const tabs: TabDef[] = [
    { id: "all", label: "All", content: <AllFeed now={now} /> },
    { id: "runs", label: "Runs", content: <RunsFeed now={now} /> },
    { id: "sessions", label: "Sessions", content: <SessionsFeed now={now} /> },
  ];
  return <Tabs tabs={tabs} label="Activity views" param="view" />;
}
