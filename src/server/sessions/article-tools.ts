import { type ToolSet, tool } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveArticleName } from "../../shared/article-name.ts";
import type { KiriDb } from "../db/index.ts";
import { articles } from "../db/schema.ts";
import type { KiriEvent } from "../events/index.ts";
import { articleSlugSchema } from "../workflows/schema.ts";

type Article = typeof articles.$inferSelect;

/**
 * First-party tools that let a session write and manage articles —
 * standalone documents saved outside the transcript and read back through the
 * articles UI. Their scope follows the session's home: a projectless session
 * sees and touches only articles it produced itself, while a session created
 * within a project works the project's shared corpus — every article any of
 * the project's sessions wrote. `read_article` with a `run_id` additionally
 * reads an article a workflow run produced (run articles are immutable, so
 * the write tools stay in scope). Every write publishes `article.written` —
 * carrying the project id for corpus writes — so open views can refresh.
 * Expected failures (unknown slug, duplicate slug, ambiguous edit) throw with
 * a message naming the tool call that recovers from them — the SDK surfaces
 * it to the model as a tool error and the turn continues.
 */
export function articleTools(
  db: KiriDb,
  sessionId: string,
  projectId: string | null,
  publish: (event: KiriEvent) => void,
): ToolSet {
  // One word of copy and one owner column separate the two scopes; every
  // query and message below rides these three values.
  const scope = projectId !== null ? "project" : "session";
  const ownerFilter =
    projectId !== null ? eq(articles.projectId, projectId) : eq(articles.sessionId, sessionId);
  const owner = projectId !== null ? { projectId } : { sessionId };

  const bySlug = (slug: string): Article | undefined =>
    db
      .select()
      .from(articles)
      .where(and(ownerFilter, eq(articles.slug, slug)))
      .get();

  const requireArticle = (slug: string): Article => {
    const row = bySlug(slug);
    if (!row) {
      throw new Error(
        `No article with slug "${slug}" in this ${scope} — call list_articles to see what exists.`,
      );
    }
    return row;
  };

  const written = (slug: string): void =>
    publish({
      type: "article.written",
      sessionId,
      slug,
      ...(projectId !== null ? { projectId } : {}),
    });

  return {
    create_article: tool({
      description:
        "Create an article: a standalone written deliverable saved outside this conversation, shown in the app for the user to read and keep. Use it when the user asks for a write-up, report, digest, guide, or any document meant to outlive the chat — put the full piece in the article and keep the chat reply to a short pointer.",
      inputSchema: z.object({
        slug: articleSlugSchema.describe(
          `URL-safe identifier: lowercase letters, digits, and hyphens (e.g. "pr-digest"). Unique within this ${scope}.`,
        ),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Display label shown alongside the article. Defaults to a humanised form of the slug ("pr-digest" → "PR Digest").',
          ),
        content_md: z
          .string()
          .min(1)
          .describe("Full article body in markdown, opening with a `# ` title heading."),
      }),
      execute: async ({ slug, name, content_md }) => {
        if (bySlug(slug)) {
          throw new Error(
            `An article with slug "${slug}" already exists in this ${scope} — use edit_article for a targeted change or replace_article to rewrite it.`,
          );
        }
        const resolved = resolveArticleName(slug, name);
        db.insert(articles)
          .values({
            id: crypto.randomUUID(),
            ...owner,
            slug,
            name: resolved,
            contentMd: content_md.trimEnd(),
            createdAt: new Date(),
          })
          .run();
        written(slug);
        return { slug, name: resolved };
      },
    }),

    replace_article: tool({
      description: `Replace the entire body of one of this ${scope}'s articles, and optionally its display name. Reach for this for wholesale rewrites; for a targeted change to existing text, prefer edit_article.`,
      inputSchema: z.object({
        slug: articleSlugSchema.describe("Slug of the article to replace."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New display label. Leave unset to keep the current one."),
        content_md: z
          .string()
          .min(1)
          .describe(
            "The complete new article body in markdown — it replaces the current body in full.",
          ),
      }),
      execute: async ({ slug, name, content_md }) => {
        const row = requireArticle(slug);
        const resolved = name ?? row.name;
        db.update(articles)
          .set({ contentMd: content_md.trimEnd(), name: resolved })
          .where(eq(articles.id, row.id))
          .run();
        written(slug);
        return { slug, name: resolved };
      },
    }),

    edit_article: tool({
      description: `Make a targeted edit to one of this ${scope}'s articles by replacing an exact string in its body. old_string must match the current text exactly — including whitespace — and appear exactly once unless replace_all is set. For a wholesale rewrite use replace_article instead.`,
      inputSchema: z.object({
        slug: articleSlugSchema.describe("Slug of the article to edit."),
        old_string: z
          .string()
          .min(1)
          .describe("Exact text currently in the article body to replace."),
        new_string: z.string().describe("Replacement text. May be empty to delete old_string."),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            "Replace every occurrence of old_string instead of requiring it to be unique. Defaults to false.",
          ),
      }),
      execute: async ({ slug, old_string, new_string, replace_all }) => {
        if (old_string === new_string) {
          throw new Error("old_string and new_string are identical — nothing to change.");
        }
        const row = requireArticle(slug);
        const count = row.contentMd.split(old_string).length - 1;
        if (count === 0) {
          throw new Error(
            `old_string was not found in article "${slug}" — call read_article and retry with the exact current text.`,
          );
        }
        if (count > 1 && replace_all !== true) {
          throw new Error(
            `old_string appears ${count} times in article "${slug}" — include more surrounding context to pin down one occurrence, or set replace_all to change every one.`,
          );
        }
        db.update(articles)
          .set({ contentMd: row.contentMd.replaceAll(old_string, new_string) })
          .where(eq(articles.id, row.id))
          .run();
        written(slug);
        return { slug, replacements: count };
      },
    }),

    delete_article: tool({
      description: `Delete one of this ${scope}'s articles permanently by slug. Use it when the user asks to remove an article, or when curating away a document that is wrong, stale, or superseded. This cannot be undone — when the content might still be wanted, prefer editing it instead.`,
      inputSchema: z.object({
        slug: articleSlugSchema.describe("Slug of the article to delete."),
      }),
      execute: async ({ slug }) => {
        const row = requireArticle(slug);
        db.delete(articles).where(eq(articles.id, row.id)).run();
        publish({
          type: "article.deleted",
          sessionId,
          slug,
          ...(projectId !== null ? { projectId } : {}),
        });
        return { slug, deleted: true };
      },
    }),

    list_articles: tool({
      description:
        projectId !== null
          ? "List the articles in this session's project — the shared corpus every one of the project's sessions reads and writes — slug, display name, and creation time. Articles produced by workflow runs are not included."
          : "List the articles this session has written so far — slug, display name, and creation time. Articles produced by workflow runs are not included.",
      inputSchema: z.object({}),
      execute: async () =>
        db
          .select({ slug: articles.slug, name: articles.name, createdAt: articles.createdAt })
          .from(articles)
          .where(ownerFilter)
          .orderBy(asc(articles.createdAt))
          .all()
          .map((row) => ({
            slug: row.slug,
            name: row.name,
            created_at: row.createdAt.toISOString(),
          })),
    }),

    read_article: tool({
      description: `Read the full markdown body of an article: one of this ${scope}'s by slug, or — when run_id is set — one a workflow run produced.`,
      inputSchema: z.object({
        slug: articleSlugSchema.describe("Slug of the article to read."),
        run_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Set to read an article a workflow run produced instead of a session article: the run's id, as reported in a run_workflow outcome. Leave unset for this session's own articles.",
          ),
      }),
      execute: async ({ slug, run_id }) => {
        if (run_id !== undefined) {
          const row = db
            .select()
            .from(articles)
            .where(and(eq(articles.runId, run_id), eq(articles.slug, slug)))
            .get();
          if (!row) {
            throw new Error(
              `No article with slug "${slug}" on run "${run_id}" — a run_workflow outcome lists its run's article slugs alongside its run_id.`,
            );
          }
          return { slug: row.slug, name: row.name, content_md: row.contentMd };
        }
        const row = bySlug(slug);
        if (!row) {
          throw new Error(
            `No article with slug "${slug}" in this ${scope} — call list_articles to see what exists, or pass run_id to read an article a workflow run produced.`,
          );
        }
        return { slug, name: row.name, content_md: row.contentMd };
      },
    }),
  };
}
