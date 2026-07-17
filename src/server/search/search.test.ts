import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, messages, runs, sessions } from "../db/schema.ts";
import { type Registry, createRegistry } from "../workflows/index.ts";
import type { WorkflowDefinition } from "../workflows/index.ts";
import { buildMatchExpression, search } from "./search.ts";

const WORKFLOWS: WorkflowDefinition[] = [
  {
    name: "pr-review",
    description: "Reviews open pull requests",
    group: "github",
    steps: [{ sh: "echo review" }],
  },
  {
    name: "news-digest",
    steps: [{ sh: "echo digest" }],
  },
];

describe("search", () => {
  let dir: string;
  let db: KiriDb;
  let registry: Registry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-search-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    registry = createRegistry();
    registry.replace(new Map(WORKFLOWS.map((wf) => [wf.name, wf])));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const seedRun = (id: string, workflowName: string, summary: string | null = null) => {
    db.insert(runs)
      .values({
        id,
        workflowName,
        status: "ok",
        startedAt: new Date(),
        definitionSnapshot: {},
        summary,
      })
      .run();
  };

  const seedArticle = (id: string, runId: string, name: string, contentMd: string) => {
    db.insert(articles)
      .values({ id, runId, slug: id, name, contentMd, createdAt: new Date() })
      .run();
  };

  const seedSession = (id: string) => {
    db.insert(sessions).values({ id, status: "idle", model: "m", startedAt: new Date() }).run();
  };

  const seedMessage = (
    id: string,
    sessionId: string,
    index: number,
    role: string,
    text: string,
  ) => {
    db.insert(messages)
      .values({
        id,
        sessionId,
        index,
        role,
        parts: [{ type: "text", text }],
        createdAt: new Date(),
      })
      .run();
  };

  describe("buildMatchExpression", () => {
    it("returns null when the input holds no tokens", () => {
      expect(buildMatchExpression("")).toBeNull();
      expect(buildMatchExpression("   \t\n ")).toBeNull();
    });

    it("quotes each token as a prefix phrase", () => {
      expect(buildMatchExpression("pelican")).toBe('"pelican"*');
      expect(buildMatchExpression("  pelican   pier ")).toBe('"pelican"* "pier"*');
    });

    it("neutralises FTS5 operator syntax", () => {
      expect(buildMatchExpression("NEAR AND")).toBe('"NEAR"* "AND"*');
      expect(buildMatchExpression('pel"ican')).toBe('"pel""ican"*');
      expect(buildMatchExpression('"')).toBe('""""*');
    });
  });

  it("returns empty results for a tokenless query", () => {
    seedRun("r1", "wf", "Something happened.");
    expect(search({ db, registry }, "  ")).toEqual({
      articles: [],
      sessions: [],
      runs: [],
      workflows: [],
    });
  });

  it("finds an article by a stemmed prefix of its body and highlights the hits", () => {
    seedRun("r1", "digester");
    seedArticle("art-1", "r1", "Daily Digest", "Pelicans nested on the pier.");

    const results = search({ db, registry }, "pelican");
    expect(results.sessions).toEqual([]);
    expect(results.runs).toEqual([]);
    expect(results.articles).toEqual([
      {
        id: "art-1",
        slug: "art-1",
        name: "Daily Digest",
        runId: "r1",
        sessionId: null,
        snippet: [
          { text: "Pelicans", match: true },
          { text: " nested on the pier.", match: false },
        ],
      },
    ]);
  });

  it("ranks a title match above a body-only match", () => {
    seedRun("r1", "digester");
    seedArticle("art-body", "r1", "Morning Notes", "A pelican was spotted again.");
    seedArticle("art-title", "r1", "Pelican Watch", "Nothing else to report.");

    const results = search({ db, registry }, "pelican");
    expect(results.articles.map((hit) => hit.id)).toEqual(["art-title", "art-body"]);
  });

  it("collapses matching messages into one session hit with its feed preview", () => {
    seedSession("sess-1");
    seedMessage("m1", "sess-1", 0, "user", "Tell me about pelicans");
    seedMessage("m2", "sess-1", 1, "assistant", "Pelicans are large water birds.");

    const results = search({ db, registry }, "pelican");
    expect(results.sessions).toHaveLength(1);
    expect(results.sessions[0]?.id).toBe("sess-1");
    expect(results.sessions[0]?.preview).toBe("Tell me about pelicans");
    expect(results.sessions[0]?.snippet.some((segment) => segment.match)).toBe(true);
  });

  it("never surfaces a child session's transcript", () => {
    seedSession("parent");
    seedMessage("m1", "parent", 0, "user", "Tell me about pelicans");
    db.insert(sessions)
      .values({
        id: "child",
        status: "idle",
        model: "m",
        startedAt: new Date(),
        parentSessionId: "parent",
        parentToolCallId: "call_1",
      })
      .run();
    seedMessage("m2", "child", 0, "assistant", "Pelicans dive for fish.");

    const results = search({ db, registry }, "pelican");
    expect(results.sessions.map((s) => s.id)).toEqual(["parent"]);
  });

  it("leaves the preview empty for a session with no user text", () => {
    seedSession("sess-2");
    seedMessage("m1", "sess-2", 0, "assistant", "Unprompted pelican facts.");

    const results = search({ db, registry }, "pelican");
    expect(results.sessions).toEqual([
      {
        id: "sess-2",
        preview: "",
        snippet: [
          { text: "Unprompted ", match: false },
          { text: "pelican", match: true },
          { text: " facts.", match: false },
        ],
      },
    ]);
  });

  it("finds a run by its summary and carries the workflow name", () => {
    seedRun("r1", "news-digest", "Collected three pelican stories.");

    const results = search({ db, registry }, "pelican");
    expect(results.runs).toEqual([
      {
        id: "r1",
        workflowName: "news-digest",
        snippet: [
          { text: "Collected three ", match: false },
          { text: "pelican", match: true },
          { text: " stories.", match: false },
        ],
      },
    ]);
  });

  it("matches workflows on name, description, and group, case-insensitively", () => {
    expect(search({ db, registry }, "PR-REV").workflows).toEqual([
      { name: "pr-review", description: "Reviews open pull requests", group: "github" },
    ]);
    expect(search({ db, registry }, "pull requests").workflows.map((w) => w.name)).toEqual([
      "pr-review",
    ]);
    expect(search({ db, registry }, "github").workflows.map((w) => w.name)).toEqual(["pr-review"]);
    expect(search({ db, registry }, "digest").workflows).toEqual([
      { name: "news-digest", description: undefined, group: undefined },
    ]);
  });

  it("returns workflow matches even when the index has no hits", () => {
    const results = search({ db, registry }, "pr-review");
    expect(results.articles).toEqual([]);
    expect(results.sessions).toEqual([]);
    expect(results.runs).toEqual([]);
    expect(results.workflows.map((w) => w.name)).toEqual(["pr-review"]);
  });

  it("caps index-backed hits at the limit without counting merged session rows", () => {
    seedRun("r1", "digester");
    seedArticle("a1", "r1", "Pelican One", "pelican");
    seedArticle("a2", "r1", "Pelican Two", "pelican");
    seedSession("sess-1");
    seedMessage("m1", "sess-1", 0, "user", "pelican pelican pelican");
    seedMessage("m2", "sess-1", 1, "assistant", "pelican pelican");

    const results = search({ db, registry }, "pelican", 3);
    const total = results.articles.length + results.sessions.length + results.runs.length;
    expect(total).toBe(3);
    expect(results.sessions).toHaveLength(1);
  });

  it("caps workflow matches at the limit", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      name: `wf-${i}`,
      steps: [{ sh: "echo hi" }],
    }));
    registry.replace(new Map(many.map((wf) => [wf.name, wf])));
    expect(search({ db, registry }, "wf-", 2).workflows).toHaveLength(2);
  });

  it("survives indexed text that contains the highlight sentinels", () => {
    seedRun("r1", "digester");
    seedArticle("a1", "r1", "Odd", "pelican \uE000 stray sentinel");

    const results = search({ db, registry }, "pelican");
    const joined = results.articles[0]?.snippet.map((segment) => segment.text).join("");
    expect(joined).toContain("pelican");
    expect(joined).toContain("stray sentinel");
  });

  it("finds no ghosts for punctuation-only queries", () => {
    seedRun("r1", "digester");
    seedArticle("a1", "r1", "Digest", "Plain prose without dashes.");

    const results = search({ db, registry }, "-");
    expect(results.articles).toEqual([]);
    expect(results.sessions).toEqual([]);
    expect(results.runs).toEqual([]);
  });
});
