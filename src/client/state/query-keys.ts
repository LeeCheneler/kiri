/**
 * Every query key the app caches under, in one place. Queries never go stale
 * on their own, so a key is only as fresh as the events that invalidate it:
 * `invalidation.ts` maps each server event to keys from this module, and its
 * tests fail for a key here that no event reaches. A key with an optional
 * trailing argument doubles as the prefix of everything beneath it.
 */

/** The unified activity feed of runs and sessions. */
export const activityFeedKey = ["activity", "feed"] as const;

/** The articles feed across every producer. */
export const articleFeedKey = ["activity", "articles"] as const;

/** The config-health report. */
export const configHealthKey = ["config", "health"] as const;

/** The configured MCP servers and their connection status. */
export const mcpServersKey = ["mcp", "servers"] as const;

/** Every MCP and built-in tool with its standing permission. */
export const mcpToolsKey = ["mcp", "tools"] as const;

/** The workspace-global memory index. */
export const memoriesKey = ["memories"] as const;

/** One workspace-global memory. */
export const memoryKey = (name: string) => ["memory", name] as const;

/** The models the configured providers offer. */
export const modelsKey = ["models"] as const;

/** The project index. */
export const projectsKey = ["projects"] as const;

/** One project's subtree: its overview and its paged article and session indexes extend this key. */
export const projectKey = (id: string) => ["project", id] as const;

/** One article of a project's corpus, or every cached one without `slug`. */
export const projectArticleKey = (id: string, slug?: string) =>
  slug === undefined
    ? (["project-article", id] as const)
    : (["project-article", id, slug] as const);

/** One project-scoped memory, or every cached one without `name`. */
export const projectMemoryKey = (id: string, name?: string) =>
  name === undefined ? (["project-memory", id] as const) : (["project-memory", id, name] as const);

/** One project's task list. */
export const projectTasksKey = (projectId: string) => ["project-tasks", projectId] as const;

/** One run's detail. */
export const runKey = (id: string) => ["run", id] as const;

/** One article a run produced, or every cached one of that run without `slug`. */
export const runArticleKey = (runId: string, slug?: string) =>
  slug === undefined ? (["article", runId] as const) : (["article", runId, slug] as const);

/** A run feed: one workflow's, or — without `workflow` — the all-workflows feed every other extends. */
export const runFeedKey = (workflow?: string) =>
  workflow === undefined ? (["runs", "feed"] as const) : (["runs", "feed", workflow] as const);

/** The prefix of every cached run window. */
export const runWindowsKey = ["runs", "window"] as const;

/** One workflow's most recent `limit` runs. */
export const runWindowKey = (workflow: string, limit: number) =>
  [...runWindowsKey, workflow, limit] as const;

/** One search term's results. Re-queried on every use, so no event invalidates it. */
export const searchKey = (q: string) => ["search", q] as const;

/** One session with its transcript and queued messages. */
export const sessionKey = (id: string) => ["session", id] as const;

/** One article a session wrote, or every cached one of that session without `slug`. */
export const sessionArticleKey = (sessionId: string, slug?: string) =>
  slug === undefined
    ? (["session-article", sessionId] as const)
    : (["session-article", sessionId, slug] as const);

/** The list of articles a session wrote. */
export const sessionArticlesKey = (sessionId: string) => ["session-articles", sessionId] as const;

/** A session's delegated workers, keyed by the parent. */
export const sessionChildrenKey = (id: string) => ["session-children", id] as const;

/** The paged session list. */
export const sessionsFeedKey = ["sessions", "feed"] as const;

/** The workflow registry. */
export const workflowsKey = ["workflows"] as const;

/** The running build's version. Fixed for the life of the page. */
export const versionKey = ["version"] as const;

/** The newest published release. Fetched once per page load; nothing the server does changes it. */
export const latestReleaseKey = ["latest-release"] as const;

/**
 * Keys no server event invalidates, each for the reason its own comment gives.
 * A reconnect, which otherwise restales everything, leaves these alone too.
 */
export const STATIC_KEY_ROOTS: readonly string[] = [
  searchKey("")[0],
  versionKey[0],
  latestReleaseKey[0],
];
