import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, runs } from "../db/schema.ts";
import type { KiriEvent } from "../events/index.ts";
import { articleTools } from "./article-tools.ts";
import { createSession } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("articleTools", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-article-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createSession(db, MODEL, { id: "s1" });
    events = [];
    tools = articleTools(db, "s1", (event) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const readBody = async (slug: string): Promise<string> => {
    const output = (await run(tools.read_article, { slug })) as { content_md: string };
    return output.content_md;
  };

  describe("create_article", () => {
    it("creates an article with a humanised default name and publishes article.written", async () => {
      const output = await run(tools.create_article, {
        slug: "pr-digest",
        content_md: "# PR Digest\n\nBody.\n",
      });

      expect(output).toEqual({ slug: "pr-digest", name: "PR Digest" });
      expect(await readBody("pr-digest")).toBe("# PR Digest\n\nBody.");
      expect(events).toContainEqual({
        type: "article.written",
        sessionId: "s1",
        slug: "pr-digest",
      });
    });

    it("uses an explicit name over the humanised slug", async () => {
      const output = await run(tools.create_article, {
        slug: "pr-digest",
        name: "Pull Request Digest",
        content_md: "# Digest",
      });
      expect(output).toEqual({ slug: "pr-digest", name: "Pull Request Digest" });
    });

    it("rejects a slug that already exists in the session", async () => {
      await run(tools.create_article, { slug: "notes", content_md: "# Notes" });
      expect(run(tools.create_article, { slug: "notes", content_md: "# Again" })).rejects.toThrow(
        'An article with slug "notes" already exists',
      );
    });

    it("scopes slug uniqueness to the session", async () => {
      createSession(db, MODEL, { id: "s2" });
      const other = articleTools(db, "s2", () => {});

      await run(tools.create_article, { slug: "notes", content_md: "# Mine" });
      await run(other.create_article, { slug: "notes", content_md: "# Theirs" });

      expect(await readBody("notes")).toBe("# Mine");
    });
  });

  describe("replace_article", () => {
    it("replaces the body and keeps the name when unset", async () => {
      await run(tools.create_article, { slug: "notes", content_md: "# Old" });
      events = [];

      const output = await run(tools.replace_article, { slug: "notes", content_md: "# New\n" });

      expect(output).toEqual({ slug: "notes", name: "Notes" });
      expect(await readBody("notes")).toBe("# New");
      expect(events).toContainEqual({ type: "article.written", sessionId: "s1", slug: "notes" });
    });

    it("updates the name when one is given", async () => {
      await run(tools.create_article, { slug: "notes", content_md: "# Old" });
      const output = await run(tools.replace_article, {
        slug: "notes",
        name: "Meeting Notes",
        content_md: "# New",
      });
      expect(output).toEqual({ slug: "notes", name: "Meeting Notes" });
    });

    it("rejects an unknown slug", () => {
      expect(run(tools.replace_article, { slug: "ghost", content_md: "# X" })).rejects.toThrow(
        'No article with slug "ghost" in this session',
      );
    });
  });

  describe("edit_article", () => {
    beforeEach(async () => {
      await run(tools.create_article, {
        slug: "notes",
        content_md: "# Notes\n\nAlpha beta.\n\nAlpha gamma.",
      });
      events = [];
    });

    it("replaces a unique occurrence and publishes article.written", async () => {
      const output = await run(tools.edit_article, {
        slug: "notes",
        old_string: "Alpha beta.",
        new_string: "Alpha delta.",
      });

      expect(output).toEqual({ slug: "notes", replacements: 1 });
      expect(await readBody("notes")).toBe("# Notes\n\nAlpha delta.\n\nAlpha gamma.");
      expect(events).toContainEqual({ type: "article.written", sessionId: "s1", slug: "notes" });
    });

    it("deletes text when new_string is empty", async () => {
      await run(tools.edit_article, {
        slug: "notes",
        old_string: "\n\nAlpha gamma.",
        new_string: "",
      });
      expect(await readBody("notes")).toBe("# Notes\n\nAlpha beta.");
    });

    it("rejects identical old_string and new_string", () => {
      expect(
        run(tools.edit_article, { slug: "notes", old_string: "Alpha", new_string: "Alpha" }),
      ).rejects.toThrow("identical");
    });

    it("rejects an old_string that is not in the article", () => {
      expect(
        run(tools.edit_article, { slug: "notes", old_string: "Omega", new_string: "X" }),
      ).rejects.toThrow('old_string was not found in article "notes"');
    });

    it("rejects an ambiguous old_string unless replace_all is set", async () => {
      expect(
        run(tools.edit_article, { slug: "notes", old_string: "Alpha", new_string: "Omega" }),
      ).rejects.toThrow('old_string appears 2 times in article "notes"');

      const output = await run(tools.edit_article, {
        slug: "notes",
        old_string: "Alpha",
        new_string: "Omega",
        replace_all: true,
      });
      expect(output).toEqual({ slug: "notes", replacements: 2 });
      expect(await readBody("notes")).toBe("# Notes\n\nOmega beta.\n\nOmega gamma.");
    });

    it("rejects an unknown slug", () => {
      expect(
        run(tools.edit_article, { slug: "ghost", old_string: "a", new_string: "b" }),
      ).rejects.toThrow('No article with slug "ghost" in this session');
    });
  });

  describe("list_articles", () => {
    it("returns an empty list before any article is written", async () => {
      expect(await run(tools.list_articles, {})).toEqual([]);
    });

    it("lists only this session's articles, oldest first", async () => {
      createSession(db, MODEL, { id: "s2" });
      const other = articleTools(db, "s2", () => {});
      await run(other.create_article, { slug: "elsewhere", content_md: "# Other" });
      await run(tools.create_article, { slug: "alpha", content_md: "# A" });
      await run(tools.create_article, { slug: "beta", name: "Second", content_md: "# B" });

      const output = (await run(tools.list_articles, {})) as {
        slug: string;
        name: string;
        created_at: string;
      }[];

      expect(output.map((row) => row.slug)).toEqual(["alpha", "beta"]);
      expect(output[1].name).toBe("Second");
      expect(Date.parse(output[0].created_at)).not.toBeNaN();
    });
  });

  describe("read_article", () => {
    // A run-produced article, as the runner would store it: linked to a runs
    // row via runId, no sessionId.
    const seedRunArticle = (runId: string, slug: string, contentMd: string): void => {
      db.insert(runs)
        .values({
          id: runId,
          workflowName: "news",
          status: "ok",
          startedAt: new Date(),
          definitionSnapshot: { name: "news", steps: [] },
        })
        .run();
      db.insert(articles)
        .values({
          id: crypto.randomUUID(),
          runId,
          slug,
          name: "Edition",
          contentMd,
          createdAt: new Date(),
        })
        .run();
    };

    it("returns the article's name and full body", async () => {
      await run(tools.create_article, { slug: "notes", content_md: "# Notes\n\nBody." });
      expect(await run(tools.read_article, { slug: "notes" })).toEqual({
        slug: "notes",
        name: "Notes",
        content_md: "# Notes\n\nBody.",
      });
    });

    it("rejects an unknown slug, naming the run_id recovery", () => {
      expect(run(tools.read_article, { slug: "ghost" })).rejects.toThrow(
        'No article with slug "ghost" in this session — call list_articles to see what exists, or pass run_id',
      );
    });

    it("reads an article a workflow run produced when run_id is set", async () => {
      seedRunArticle("r1", "edition", "# Edition\n\nStories.");
      expect(await run(tools.read_article, { slug: "edition", run_id: "r1" })).toEqual({
        slug: "edition",
        name: "Edition",
        content_md: "# Edition\n\nStories.",
      });
    });

    it("does not fall back to session articles when run_id is set", async () => {
      await run(tools.create_article, { slug: "edition", content_md: "# Mine" });
      expect(run(tools.read_article, { slug: "edition", run_id: "ghost" })).rejects.toThrow(
        'No article with slug "edition" on run "ghost"',
      );
    });

    it("keeps session reads session-scoped when run_id is unset", async () => {
      seedRunArticle("r1", "edition", "# Edition");
      expect(run(tools.read_article, { slug: "edition" })).rejects.toThrow(
        'No article with slug "edition" in this session',
      );
    });
  });
});
