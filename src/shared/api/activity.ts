import type { RunListEntry } from "./runs.ts";
import type { SessionListEntry } from "./sessions.ts";

/**
 * One entry in the unified activity feed: a workflow run or a session, tagged
 * by `kind` so the feed renders the right row. Entries are ordered newest-first
 * by start time across both kinds.
 */
export type ActivityEntry =
  | { kind: "run"; run: RunListEntry }
  | { kind: "session"; session: SessionListEntry };

/**
 * The container an article belongs to, as the articles feed names it: the
 * workflow behind a run, a session by its title (else opening message, else
 * short id), or a project. `id` addresses the container itself; callers build
 * both the container's path and the article's from `kind` and `id`.
 */
export type ArticleProducer =
  | { kind: "run"; id: string; label: string }
  | { kind: "session"; id: string; label: string }
  | { kind: "project"; id: string; label: string };

/**
 * One row in the articles feed — an article as a first-class timeline entry
 * rather than a line under whatever produced it. `heading` is the body's first
 * markdown heading, null when it has none; fall back to `name`.
 */
export interface ArticleFeedEntry {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: string;
  producer: ArticleProducer;
}

/**
 * One page of the unified activity feed. `nextCursor` is an opaque token for
 * the next page when a further one exists; `null` on the final page.
 */
export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

/** One page of the articles feed, paged like {@link ActivityPage}. */
export interface ArticleFeedPage {
  entries: ArticleFeedEntry[];
  nextCursor: string | null;
}
