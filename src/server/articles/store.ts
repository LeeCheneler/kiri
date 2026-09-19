import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { resolveArticleName } from "../../shared/article-name.ts";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import type { KiriDb } from "../db/index.ts";
import { articles } from "../db/schema.ts";

/** A persisted article row. */
export type Article = typeof articles.$inferSelect;

/**
 * The one record an article belongs to: the workflow run or session that
 * wrote it, or the project whose shared corpus it sits in. A slug is unique
 * within its owner, so an owner and a slug address at most one article.
 */
export type ArticleOwner = { runId: string } | { sessionId: string } | { projectId: string };

/** One entry of an article index: summary metadata plus the body's first heading. */
export interface ArticleSummary {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: Date;
}

const ownedBy = (owner: ArticleOwner) => {
  if ("runId" in owner) return eq(articles.runId, owner.runId);
  if ("sessionId" in owner) return eq(articles.sessionId, owner.sessionId);
  return eq(articles.projectId, owner.projectId);
};

// An index entry's columns. The body stays unread: its heading is stored beside it.
const summaryColumns = {
  slug: articles.slug,
  name: articles.name,
  heading: articles.heading,
  createdAt: articles.createdAt,
};

// A body as it is stored, with the heading the indexes show for it.
const storedBody = (contentMd: string) => {
  const body = contentMd.trimEnd();
  return { contentMd: body, heading: extractFirstHeading(body) };
};

/**
 * The owner of the articles a session reads and writes: its project's shared
 * corpus when it belongs to one, otherwise the session itself.
 */
export function sessionArticleOwner(session: {
  id: string;
  projectId: string | null;
}): ArticleOwner {
  return session.projectId !== null ? { projectId: session.projectId } : { sessionId: session.id };
}

/** Read one of an owner's articles by slug, or `undefined` if none exists. */
export function getArticle(db: KiriDb, owner: ArticleOwner, slug: string): Article | undefined {
  return db
    .select()
    .from(articles)
    .where(and(ownedBy(owner), eq(articles.slug, slug)))
    .get();
}

/**
 * An owner's article index, oldest first unless `newestFirst` is set. Bodies
 * are never read — detail surfaces serve them.
 */
export function listArticleSummaries(
  db: KiriDb,
  owner: ArticleOwner,
  opts: { newestFirst?: boolean } = {},
): ArticleSummary[] {
  return db
    .select(summaryColumns)
    .from(articles)
    .where(ownedBy(owner))
    .orderBy(
      ...(opts.newestFirst === true
        ? [desc(articles.createdAt), desc(articles.id)]
        : [asc(articles.createdAt)]),
    )
    .all();
}

/**
 * The article indexes of many runs or many sessions in one query, keyed by
 * owner id with each owner's entries oldest first. An owner with no articles
 * is absent from the map. Listing surfaces use it to stay flat in the page
 * size.
 */
export function articleSummariesByOwner(
  db: KiriDb,
  kind: "runId" | "sessionId",
  ownerIds: string[],
): Map<string, ArticleSummary[]> {
  const byOwner = new Map<string, ArticleSummary[]>();
  if (ownerIds.length === 0) return byOwner;

  const rows = db
    .select({ ownerId: articles[kind], ...summaryColumns })
    .from(articles)
    .where(inArray(articles[kind], ownerIds))
    .orderBy(asc(articles.createdAt))
    .all();

  for (const { ownerId, ...summary } of rows) {
    const list = byOwner.get(ownerId as string);
    if (list) list.push(summary);
    else byOwner.set(ownerId as string, [summary]);
  }

  return byOwner;
}

/**
 * Create an article under `owner`. The display name defaults to a humanised
 * form of the slug, and the body is stored without trailing whitespace, its
 * first heading beside it. A slug the owner already uses throws from the
 * unique index. Returns the persisted row.
 */
export function createArticle(
  db: KiriDb,
  owner: ArticleOwner,
  input: { slug: string; name?: string | undefined; contentMd: string },
): Article {
  const id = crypto.randomUUID();
  db.insert(articles)
    .values({
      id,
      ...owner,
      slug: input.slug,
      name: resolveArticleName(input.slug, input.name),
      ...storedBody(input.contentMd),
      createdAt: new Date(),
    })
    .run();

  return db.select().from(articles).where(eq(articles.id, id)).get() as Article;
}

/**
 * Rewrite an article's body, and its display name when one is given. The body
 * is stored without trailing whitespace and its stored heading follows it.
 * Returns the updated row.
 */
export function updateArticle(
  db: KiriDb,
  id: string,
  patch: { name?: string | undefined; contentMd: string },
): Article {
  db.update(articles)
    .set({
      ...storedBody(patch.contentMd),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    })
    .where(eq(articles.id, id))
    .run();

  return db.select().from(articles).where(eq(articles.id, id)).get() as Article;
}

/** Permanently delete an article. Deleting an absent article removes nothing. */
export function deleteArticle(db: KiriDb, id: string): void {
  db.delete(articles).where(eq(articles.id, id)).run();
}
