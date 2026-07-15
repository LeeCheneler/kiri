import { inArray } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { articles } from "../db/schema.ts";
import { getSessionPreviews } from "../sessions/store.ts";
import type { Registry } from "../workflows/index.ts";

/**
 * One piece of a result snippet. `match` marks the pieces that hit a query
 * term so the UI can highlight them.
 */
export interface SnippetSegment {
  text: string;
  match: boolean;
}

export interface ArticleHit {
  id: string;
  slug: string;
  name: string;
  /** Producing run, or null for session articles — one of the two is always set. */
  runId: string | null;
  sessionId: string | null;
  snippet: SnippetSegment[];
}

export interface SessionHit {
  id: string;
  /** The session's feed label (first user message); empty when it has none. */
  preview: string;
  /** Snippet of the best-ranked matching message. */
  snippet: SnippetSegment[];
}

export interface RunHit {
  id: string;
  workflowName: string;
  /** Snippet of the run's summary. */
  snippet: SnippetSegment[];
}

export interface WorkflowHit {
  name: string;
  description?: string;
  group?: string;
}

export interface SearchResults {
  articles: ArticleHit[];
  sessions: SessionHit[];
  runs: RunHit[];
  workflows: WorkflowHit[];
}

export interface SearchDeps {
  db: KiriDb;
  registry: Registry;
}

/**
 * Convert raw user input into an FTS5 MATCH expression: each whitespace
 * token becomes a quoted prefix phrase (`"tok"*`), implicitly AND-ed.
 * Quoting neutralises FTS5 operator syntax (`AND`, `NEAR`, unbalanced
 * quotes), and the prefix star makes as-you-type queries match partial
 * words. Returns null when the input holds no tokens.
 */
export function buildMatchExpression(raw: string): string | null {
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" ");
}

// Sentinels around query-term hits in FTS5 snippet output, parsed into
// SnippetSegments before results leave this module. Private-use codepoints:
// no keyboard produces them, so indexed text is vanishingly unlikely to
// collide (a collision only garbles that snippet's highlighting). The FTS
// query passes them as char(57344)/char(57345) — the same two codepoints.
const MARK_START = "\uE000";
const MARK_END = "\uE001";

function parseSnippet(snip: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const chunks = snip.split(MARK_START);
  const head = chunks[0] as string;
  if (head !== "") segments.push({ text: head, match: false });
  for (const chunk of chunks.slice(1)) {
    const end = chunk.indexOf(MARK_END);
    const hit = end === -1 ? chunk : chunk.slice(0, end);
    const tail = end === -1 ? "" : chunk.slice(end + MARK_END.length);
    if (hit !== "") segments.push({ text: hit, match: true });
    if (tail !== "") segments.push({ text: tail, match: false });
  }
  return segments;
}

// Substring filter across name, description, and group — the same semantics
// as the workflow catalog's client-side filter, so the two surfaces agree on
// what matches.
function matchWorkflows(registry: Registry, rawQuery: string, limit: number): WorkflowHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (q === "") return [];
  return registry
    .listWorkflows()
    .filter(
      (workflow) =>
        workflow.name.toLowerCase().includes(q) ||
        (workflow.description?.toLowerCase().includes(q) ?? false) ||
        (workflow.group?.toLowerCase().includes(q) ?? false),
    )
    .slice(0, limit)
    .map((workflow) => ({
      name: workflow.name,
      description: workflow.description,
      group: workflow.group,
    }));
}

interface FtsRow {
  entity_type: string;
  entity_id: string;
  source_id: string;
  title: string;
  snip: string;
}

// Rows scanned from the index before the per-search cap is applied — the
// headroom lets a session with many matching messages collapse to one hit
// without starving lower-ranked entities of their slot.
const SCAN_LIMIT = 100;

/**
 * Search articles, sessions, and run summaries via the `search_fts` index
 * (bm25-ranked, title weighted over body) and workflow definitions via the
 * in-memory registry (substring match). At most `limit` index-backed hits
 * are returned across the three entity types combined; a session appears
 * once however many of its messages match. A query with no tokens returns
 * empty results.
 */
export function search(deps: SearchDeps, rawQuery: string, limit = 20): SearchResults {
  const { db, registry } = deps;
  const results: SearchResults = {
    articles: [],
    sessions: [],
    runs: [],
    workflows: matchWorkflows(registry, rawQuery, limit),
  };
  const match = buildMatchExpression(rawQuery);
  if (match === null) return results;

  const rows = db.$client
    .query<FtsRow, [string, number]>(
      `SELECT entity_type, entity_id, source_id, title,
              snippet(search_fts, 1, char(57344), char(57345), '…', 12) AS snip
       FROM search_fts
       WHERE search_fts MATCH ?
       ORDER BY bm25(search_fts, 4.0, 1.0)
       LIMIT ?`,
    )
    .all(match, SCAN_LIMIT);

  const seenSessions = new Set<string>();
  const articleSnippets = new Map<string, SnippetSegment[]>();
  let taken = 0;
  for (const row of rows) {
    if (taken >= limit) break;
    if (row.entity_type === "article") {
      articleSnippets.set(row.entity_id, parseSnippet(row.snip));
      taken += 1;
    } else if (row.entity_type === "run") {
      results.runs.push({
        id: row.entity_id,
        workflowName: row.title,
        snippet: parseSnippet(row.snip),
      });
      taken += 1;
    } else if (!seenSessions.has(row.entity_id)) {
      seenSessions.add(row.entity_id);
      results.sessions.push({ id: row.entity_id, preview: "", snippet: parseSnippet(row.snip) });
      taken += 1;
    }
  }

  if (articleSnippets.size > 0) {
    const rows = db
      .select({
        id: articles.id,
        slug: articles.slug,
        name: articles.name,
        runId: articles.runId,
        sessionId: articles.sessionId,
      })
      .from(articles)
      .where(inArray(articles.id, [...articleSnippets.keys()]))
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Rebuild in rank order — the enrichment select returns rows in table order.
    for (const [id, snippet] of articleSnippets) {
      const row = byId.get(id) as (typeof rows)[number];
      results.articles.push({ ...row, snippet });
    }
  }

  const previews = getSessionPreviews(
    db,
    results.sessions.map((hit) => hit.id),
  );
  for (const hit of results.sessions) {
    hit.preview = previews.get(hit.id) ?? "";
  }

  return results;
}
