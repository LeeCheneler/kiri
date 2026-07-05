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

function WorkflowsFeed({ now }: { now?: Date }) {
  const state = toState(useRunFeed(), (runs) => runs.map((run) => ({ kind: "run", run })));
  return <Feed state={state} noun="runs" now={now} />;
}

function SessionsFeed({ now }: { now?: Date }) {
  const state = toState(useSessionsFeed(), (sessions) =>
    sessions.map((session) => ({ kind: "session", session })),
  );
  return <Feed state={state} noun="sessions" now={now} />;
}

function PinnedFeed({ now }: { now?: Date }) {
  const state = toState(useSessionsFeed({ pinned: true }), (sessions) =>
    sessions.map((session) => ({ kind: "session", session })),
  );
  return <Feed state={state} noun="pinned sessions" now={now} />;
}

/**
 * The home activity feed: a deep-linkable `All · Workflows · Sessions · Pinned`
 * tab strip over one of four reverse-chronological feeds. `All` is the union of
 * runs and sessions; `Workflows` and `Sessions` are each kind on its own;
 * `Pinned` is the sessions the user has pinned. The active view lives in the
 * `?view=` search param (defaulting to `All`); only the active panel mounts, so
 * just its query runs. `now` is injectable for deterministic tests; production
 * omits it.
 */
export function ActivityFeed({ now }: { now?: Date }) {
  const tabs: TabDef[] = [
    { id: "all", label: "All", content: <AllFeed now={now} /> },
    { id: "workflows", label: "Workflows", content: <WorkflowsFeed now={now} /> },
    { id: "sessions", label: "Sessions", content: <SessionsFeed now={now} /> },
    { id: "pinned", label: "Pinned", content: <PinnedFeed now={now} /> },
  ];
  return <Tabs tabs={tabs} label="Activity views" param="view" />;
}
