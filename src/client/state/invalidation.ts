import type { QueryKey } from "@tanstack/react-query";
import type { KiriEvent, SessionOwners } from "../../shared/api/events.ts";
import {
  activityFeedKey,
  articleFeedKey,
  configHealthKey,
  mcpServersKey,
  mcpToolsKey,
  memoriesKey,
  memoryKey,
  modelsKey,
  projectArticleKey,
  projectKey,
  projectMemoryKey,
  projectTasksKey,
  projectsKey,
  runArticleKey,
  runFeedKey,
  runKey,
  runWindowsKey,
  sessionArticleKey,
  sessionArticlesKey,
  sessionChildrenKey,
  sessionKey,
  sessionsFeedKey,
  workflowsKey,
} from "./query-keys.ts";

// Every list a run appears in: the stats windows, the run feeds and the activity feed.
const runLists: QueryKey[] = [runWindowsKey, runFeedKey(), activityFeedKey];

// A project's page and the index entry that counts what it holds.
const projectViews = (projectId: string): QueryKey[] => [projectKey(projectId), projectsKey];

// Every list a session appears in: the two feeds, plus — for a session that
// has them — its project's pages and its parent's worker list.
const sessionLists = ({ projectId, parentSessionId }: SessionOwners): QueryKey[] => [
  sessionsFeedKey,
  activityFeedKey,
  ...(projectId !== null ? projectViews(projectId) : []),
  ...(parentSessionId !== null ? [sessionChildrenKey(parentSessionId)] : []),
];

/**
 * The cached queries a server event makes stale. Each key is a prefix: every
 * query beneath it is invalidated, mounted or not, so an unmounted view
 * refetches when it is next shown. This is the app's whole freshness policy —
 * queries never expire on their own — so the switch is exhaustive and has no
 * default: a new event type leaves a path that returns nothing, which does not
 * compile until the event says what it changes.
 */
export function queryKeysFor(event: KiriEvent): QueryKey[] {
  switch (event.type) {
    case "run.started":
      return runLists;

    case "run.updated":
      return [runKey(event.id), ...runLists];

    // A run's articles are rewritten as it completes, and go with it when it
    // is deleted. A rerun's start is deliberately not here: a mounted article
    // keeps its old body while the rows are rewritten, rather than flashing
    // not-found.
    case "run.finished":
    case "run.deleted":
      return [runKey(event.id), runArticleKey(event.id), articleFeedKey, ...runLists];

    case "run.step.updated":
    case "recommendation.actioned":
    case "recommendation.updated":
      return [runKey(event.runId)];

    case "session.started":
    case "session.updated":
    case "session.finished":
      return [sessionKey(event.id), ...sessionLists(event)];

    case "session.message.added":
      return [sessionKey(event.sessionId), ...sessionLists(event)];

    // The session's status change follows as `session.updated` or
    // `session.finished`, which carries the cache's share of a settle.
    case "session.turn.settled":
      return [];

    // Queued messages show only on the session itself.
    case "session.inbox.queued":
    case "session.inbox.delivered":
    case "session.inbox.withdrawn":
      return [sessionKey(event.sessionId)];

    case "session.deleted":
      return [
        sessionKey(event.id),
        sessionChildrenKey(event.id),
        sessionArticlesKey(event.id),
        sessionArticleKey(event.id),
        articleFeedKey,
        ...sessionLists(event),
      ];

    // Session list entries name the articles their session wrote.
    case "article.written":
    case "article.deleted":
      return [
        articleFeedKey,
        sessionsFeedKey,
        ...(event.sessionId !== undefined
          ? [sessionArticleKey(event.sessionId, event.slug), sessionArticlesKey(event.sessionId)]
          : []),
        ...(event.projectId !== undefined
          ? [projectArticleKey(event.projectId, event.slug), ...projectViews(event.projectId)]
          : []),
      ];

    case "project.created":
      return projectViews(event.id);

    // A rename shows wherever the project is named: on its article pages, on
    // its sessions' list entries and beside its articles in the articles feed.
    case "project.updated":
      return [
        ...projectViews(event.id),
        projectArticleKey(event.id),
        sessionsFeedKey,
        articleFeedKey,
      ];

    // Its sessions announce their own deletion.
    case "project.deleted":
      return [
        ...projectViews(event.id),
        projectArticleKey(event.id),
        projectMemoryKey(event.id),
        projectTasksKey(event.id),
        articleFeedKey,
      ];

    case "memory.saved":
    case "memory.deleted":
      return event.projectId !== undefined
        ? [projectMemoryKey(event.projectId, event.name), projectKey(event.projectId)]
        : [memoryKey(event.name), memoriesKey];

    // The index entry counts a project's open tasks.
    case "task.changed":
      return [projectTasksKey(event.projectId), projectsKey];

    case "workflow.added":
    case "workflow.updated":
    case "workflow.removed":
      return [workflowsKey];

    case "tool.permission.updated":
      return [mcpToolsKey];

    // Providers and MCP servers are both configuration; an OAuth sign-in
    // completing is announced the same way.
    case "config.changed":
      return [configHealthKey, modelsKey, mcpServersKey, mcpToolsKey];
  }
}
