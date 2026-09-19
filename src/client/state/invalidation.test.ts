import { describe, expect, it } from "bun:test";
import type { QueryKey } from "@tanstack/react-query";
import { KIRI_EVENT_TYPES, type KiriEvent, type KiriEventType } from "../../shared/api/events.ts";
import { queryKeysFor } from "./invalidation.ts";
import * as keys from "./query-keys.ts";

const UNOWNED = { projectId: null, parentSessionId: null };

const OWNED = { projectId: "p1", parentSessionId: "parent" };

// One event of every type, each naming the records it could: a project
// session with a parent, a project-scoped memory, a project article a session
// wrote. The record type makes a new event type a compile error here too.
const EVENTS: { [Type in KiriEventType]: Extract<KiriEvent, { type: Type }> } = {
  "run.started": { type: "run.started", id: "r1" },
  "run.updated": { type: "run.updated", id: "r1", status: "running" },
  "run.step.updated": { type: "run.step.updated", runId: "r1", step: 0, status: "running" },
  "run.finished": { type: "run.finished", id: "r1", status: "ok" },
  "run.deleted": { type: "run.deleted", id: "r1" },
  "recommendation.actioned": {
    type: "recommendation.actioned",
    runId: "r1",
    recommendationId: "rec1",
    actionedRunId: "r2",
  },
  "recommendation.updated": {
    type: "recommendation.updated",
    runId: "r1",
    recommendationId: "rec1",
    actionedRunId: "r2",
    status: "ok",
  },
  "session.started": { type: "session.started", id: "s1", ...OWNED },
  "session.message.added": { type: "session.message.added", sessionId: "s1", ...OWNED },
  "session.inbox.queued": { type: "session.inbox.queued", sessionId: "s1" },
  "session.inbox.delivered": { type: "session.inbox.delivered", sessionId: "s1" },
  "session.inbox.withdrawn": { type: "session.inbox.withdrawn", sessionId: "s1" },
  "session.updated": { type: "session.updated", id: "s1", status: "idle", ...OWNED },
  "session.finished": { type: "session.finished", id: "s1", status: "failed", ...OWNED },
  "session.turn.settled": { type: "session.turn.settled", id: "s1", status: "idle", ...OWNED },
  "session.deleted": { type: "session.deleted", id: "s1", ...OWNED },
  "article.written": { type: "article.written", sessionId: "s1", slug: "notes", projectId: "p1" },
  "article.deleted": { type: "article.deleted", sessionId: "s1", slug: "notes", projectId: "p1" },
  "project.created": { type: "project.created", id: "p1" },
  "project.updated": { type: "project.updated", id: "p1" },
  "project.deleted": { type: "project.deleted", id: "p1" },
  "memory.saved": { type: "memory.saved", name: "fact", projectId: "p1" },
  "memory.deleted": { type: "memory.deleted", name: "fact", projectId: "p1" },
  "task.changed": { type: "task.changed", projectId: "p1" },
  "workflow.added": { type: "workflow.added", name: "digest" },
  "workflow.updated": { type: "workflow.updated", name: "digest" },
  "workflow.removed": { type: "workflow.removed", name: "digest" },
  "tool.permission.updated": { type: "tool.permission.updated", tool: "read_file" },
  "config.changed": { type: "config.changed" },
};

// The sample memory events are project-scoped; a workspace memory's caches are
// reached only by one that names no project.
const WORKSPACE_MEMORY_SAVED: KiriEvent = { type: "memory.saved", name: "fact" };

const runLists = [
  ["runs", "window"],
  ["runs", "feed"],
  ["activity", "feed"],
];

const ownedSessionLists = [
  ["sessions", "feed"],
  ["activity", "feed"],
  ["project", "p1"],
  ["projects"],
  ["session-children", "parent"],
];

const EXPECTED: Record<KiriEventType, QueryKey[]> = {
  "run.started": runLists,
  "run.updated": [["run", "r1"], ...runLists],
  "run.step.updated": [["run", "r1"]],
  "run.finished": [["run", "r1"], ["article", "r1"], ["activity", "articles"], ...runLists],
  "run.deleted": [["run", "r1"], ["article", "r1"], ["activity", "articles"], ...runLists],
  "recommendation.actioned": [["run", "r1"]],
  "recommendation.updated": [["run", "r1"]],
  "session.started": [["session", "s1"], ...ownedSessionLists],
  "session.message.added": [["session", "s1"], ...ownedSessionLists],
  "session.inbox.queued": [["session", "s1"]],
  "session.inbox.delivered": [["session", "s1"]],
  "session.inbox.withdrawn": [["session", "s1"]],
  "session.updated": [["session", "s1"], ...ownedSessionLists],
  "session.finished": [["session", "s1"], ...ownedSessionLists],
  "session.turn.settled": [],
  "session.deleted": [
    ["session", "s1"],
    ["session-children", "s1"],
    ["session-articles", "s1"],
    ["session-article", "s1"],
    ["activity", "articles"],
    ...ownedSessionLists,
  ],
  "article.written": [
    ["activity", "articles"],
    ["sessions", "feed"],
    ["session-article", "s1", "notes"],
    ["session-articles", "s1"],
    ["project-article", "p1", "notes"],
    ["project", "p1"],
    ["projects"],
  ],
  "article.deleted": [
    ["activity", "articles"],
    ["sessions", "feed"],
    ["session-article", "s1", "notes"],
    ["session-articles", "s1"],
    ["project-article", "p1", "notes"],
    ["project", "p1"],
    ["projects"],
  ],
  "project.created": [["project", "p1"], ["projects"]],
  "project.updated": [
    ["project", "p1"],
    ["projects"],
    ["project-article", "p1"],
    ["sessions", "feed"],
    ["activity", "articles"],
  ],
  "project.deleted": [
    ["project", "p1"],
    ["projects"],
    ["project-article", "p1"],
    ["project-memory", "p1"],
    ["project-tasks", "p1"],
    ["activity", "articles"],
  ],
  "memory.saved": [
    ["project-memory", "p1", "fact"],
    ["project", "p1"],
  ],
  "memory.deleted": [
    ["project-memory", "p1", "fact"],
    ["project", "p1"],
  ],
  "task.changed": [["project-tasks", "p1"], ["projects"]],
  "workflow.added": [["workflows"]],
  "workflow.updated": [["workflows"]],
  "workflow.removed": [["workflows"]],
  "tool.permission.updated": [["mcp", "tools"]],
  "config.changed": [["config", "health"], ["models"], ["mcp", "servers"], ["mcp", "tools"]],
};

describe("queryKeysFor", () => {
  it.each(KIRI_EVENT_TYPES)("names the queries %s makes stale", (type) => {
    expect(queryKeysFor(EVENTS[type])).toEqual(EXPECTED[type]);
  });

  it("leaves projects and worker lists alone for a session that has neither", () => {
    expect(queryKeysFor({ type: "session.updated", id: "s1", status: "idle", ...UNOWNED })).toEqual(
      [
        ["session", "s1"],
        ["sessions", "feed"],
        ["activity", "feed"],
      ],
    );
  });

  it("keeps a workspace memory out of the project caches, and a project's out of the workspace's", () => {
    expect(queryKeysFor(WORKSPACE_MEMORY_SAVED)).toEqual([["memory", "fact"], ["memories"]]);
  });

  it("touches only the feeds for an article event naming neither a session nor a project", () => {
    expect(queryKeysFor({ type: "article.deleted", slug: "notes" })).toEqual([
      ["activity", "articles"],
      ["sessions", "feed"],
    ]);
  });
});

// A sample of every key the app caches under, built with the ids the sample
// events carry so a keyed invalidation can match it.
const SAMPLE_ARGS: Record<string, unknown[]> = {
  memoryKey: ["fact"],
  projectKey: ["p1"],
  projectArticleKey: ["p1", "notes"],
  projectMemoryKey: ["p1", "fact"],
  projectTasksKey: ["p1"],
  runKey: ["r1"],
  runArticleKey: ["r1", "notes"],
  runFeedKey: ["digest"],
  runWindowKey: ["digest", 30],
  searchKey: ["term"],
  sessionKey: ["s1"],
  sessionArticleKey: ["s1", "notes"],
  sessionArticlesKey: ["s1"],
  sessionChildrenKey: ["parent"],
};

const sampleKeys = (): [string, QueryKey][] =>
  Object.entries(keys).flatMap(([name, value]): [string, QueryKey][] => {
    if (name === "STATIC_KEY_ROOTS") return [];
    if (typeof value !== "function") return [[name, value as QueryKey]];
    const args = SAMPLE_ARGS[name];
    if (args === undefined) throw new Error(`add sample arguments for ${name}`);
    return [[name, (value as (...args: unknown[]) => QueryKey)(...args)]];
  });

const startsWith = (key: QueryKey, prefix: QueryKey): boolean =>
  prefix.every((part, index) => key[index] === part);

describe("query key coverage", () => {
  const invalidated = [...Object.values(EVENTS), WORKSPACE_MEMORY_SAVED].flatMap(queryKeysFor);

  it.each(sampleKeys())("%s is invalidated by some event, or declared static", (_name, key) => {
    const reached = invalidated.some((prefix) => startsWith(key, prefix));
    const declaredStatic = keys.STATIC_KEY_ROOTS.includes(String(key[0]));
    expect(reached || declaredStatic).toBe(true);
    // A static key an event reaches is no longer static: drop it from the list.
    expect(reached && declaredStatic).toBe(false);
  });
});
