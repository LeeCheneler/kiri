import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { type TabDef, Tabs } from "../../design-system/navigation/tabs.tsx";
import { useActivityFeed, useArticleFeed } from "../../state/activity.ts";
import { useRunFeed } from "../../state/runs.ts";
import { useSessionsFeed } from "../../state/sessions.ts";
import { Feed, type FeedEntry, type FeedState } from "./feed.tsx";

// Normalise an infinite feed query into the shape `Feed` renders, mapping its
// rows to tagged feed entries. Keeps each view wrapper to one line.
function toState<T>(
  feed: UseInfiniteQueryResult<T[], Error>,
  toEntries: (rows: T[]) => FeedEntry[],
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

function ArticlesFeed({ now }: { now?: Date }) {
  const state = toState(useArticleFeed(), (rows) =>
    rows.map((article) => ({ kind: "article", article })),
  );
  return <Feed state={state} noun="articles" now={now} />;
}

function SessionsFeed({ now }: { now?: Date }) {
  const state = toState(useSessionsFeed(), (sessions) =>
    sessions.map((session) => ({ kind: "session", session })),
  );
  return <Feed state={state} noun="sessions" now={now} />;
}

/**
 * The home activity feed: a deep-linkable `All · Articles · Runs · Sessions`
 * tab strip over one of four reverse-chronological feeds. `All` is the union
 * of runs and sessions; `Runs` and `Sessions` are each kind on its own.
 * `Articles` is the output view — every document any run, session, or project
 * has written, and the only place a project's shared corpus reaches the
 * timeline, since its articles belong to the project rather than to whichever
 * session edited them. It sits second because the rest of the feed is process
 * and articles are what the process is for. The tabs name the events they
 * list, not the definitions behind them — the workflow catalogue in the nav is
 * a separate surface. The active view lives in the `?view=` search param
 * (defaulting to `All`); only the active panel mounts, so just its query runs.
 * `now` is injectable for deterministic tests; production omits it.
 */
export function ActivityFeed({ now }: { now?: Date }) {
  const tabs: TabDef[] = [
    { id: "all", label: "All", content: <AllFeed now={now} /> },
    { id: "articles", label: "Articles", content: <ArticlesFeed now={now} /> },
    { id: "runs", label: "Runs", content: <RunsFeed now={now} /> },
    { id: "sessions", label: "Sessions", content: <SessionsFeed now={now} /> },
  ];
  return <Tabs tabs={tabs} label="Activity views" param="view" />;
}
