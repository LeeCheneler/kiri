import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { type SearchDeps, buildMatchExpression } from "./search.ts";

/** Explicit read scope; callers resolve the session-dependent default. */
export const knowledgeScopeSchema = z.union([
  z.literal("workspace"),
  z.object({ projectId: z.string().min(1) }).strict(),
]);

/** A stable document reference, optionally anchored inside a session. */
export const knowledgeReferenceSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.enum(["article", "memory", "run", "workflow"]), id: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("session"),
      id: z.string().min(1),
      messageId: z.string().min(1).optional(),
      offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
]);

/** Workspace-wide access or a strict project filter. */
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>;
/** Stable identity plus an optional message anchor returned by search. */
export type KnowledgeReference = z.infer<typeof knowledgeReferenceSchema>;

const offsetSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const searchOptionsSchema = z.object({
  query: z.string().max(1000),
  scope: knowledgeScopeSchema,
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).default(10),
  offset: offsetSchema.default(0),
});

/** Search options; offsets page a live result set, not a frozen snapshot. */
export type KnowledgeSearchOptions = z.input<typeof searchOptionsSchema>;

/** Text bytes per open response; this is a UTF-8 bound, not a token estimate. */
export const MAX_KNOWLEDGE_BYTES = 12_000;
const openOptionsSchema = z.object({
  reference: knowledgeReferenceSchema,
  scope: knowledgeScopeSchema,
  offset: offsetSchema.optional(),
  maxBytes: z.number().int().min(256).max(MAX_KNOWLEDGE_BYTES).default(MAX_KNOWLEDGE_BYTES),
});

/** Open options; text offsets count Unicode code points, not UTF-16 units. */
export type KnowledgeOpenOptions = z.input<typeof openOptionsSchema>;

/** Ownership, available timestamps, and a user-facing link for attribution. */
export interface KnowledgeSource {
  reference: KnowledgeReference;
  title: string;
  projectId: string | null;
  sessionId: string | null;
  runId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  href: string;
}

/** A bounded search snippet; open its reference before relying on the source. */
export interface KnowledgeHit extends KnowledgeSource {
  snippet: string;
}

interface SourceRow {
  type: "article" | "memory" | "run" | "session";
  id: string;
  title: string;
  projectId: string | null;
  sessionId: string | null;
  runId: string | null;
  slug: string | null;
  createdAt: number;
  updatedAt: number | null;
}

// Resolve ownership from live tables, including session-owned articles. Scope
// predicates run before ranking/limits so other projects cannot crowd out hits.
const SOURCE_JOINS = `
  LEFT JOIN articles a ON search_fts.entity_type = 'article' AND a.id = search_fts.entity_id
  LEFT JOIN sessions owner ON owner.id = a.session_id
  LEFT JOIN sessions s ON search_fts.entity_type = 'session' AND s.id = search_fts.entity_id
  LEFT JOIN memories m ON search_fts.entity_type = 'memory' AND m.id = search_fts.entity_id
  LEFT JOIN runs r ON search_fts.entity_type = 'run' AND r.id = search_fts.entity_id`;
const SOURCE_FIELDS = `
  search_fts.entity_type AS type, search_fts.entity_id AS id,
  substr(COALESCE(a.name, s.title, m.name, r.workflow_name, 'Untitled session'), 1, 240) AS title,
  COALESCE(a.project_id, owner.project_id, s.project_id, m.project_id) AS projectId,
  COALESCE(a.session_id, s.id) AS sessionId, COALESCE(a.run_id, r.id) AS runId,
  COALESCE(a.slug, m.name) AS slug,
  COALESCE(a.created_at, s.started_at, m.created_at, r.started_at) AS createdAt,
  m.updated_at AS updatedAt`;
const LIVE_SOURCES = `(a.id IS NOT NULL AND owner.parent_session_id IS NULL)
  OR (s.id IS NOT NULL AND s.parent_session_id IS NULL)
  OR m.id IS NOT NULL OR r.id IS NOT NULL`;

function boundedText(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += Buffer.byteLength(character);
    if (bytes > maxBytes) break;
    end += character.length;
  }
  return text.slice(0, end);
}

function checkScope(db: KiriDb, scope: KnowledgeScope): string | null {
  if (scope === "workspace") return null;
  if (!db.$client.query("SELECT id FROM projects WHERE id = ?").get(scope.projectId)) {
    throw new Error("Unknown project scope. Use a project ID returned by workspace search.");
  }
  return scope.projectId;
}

function source(row: SourceRow, reference: KnowledgeReference): KnowledgeSource {
  const id = encodeURIComponent(row.id);
  let href = `/${row.type === "session" ? "sessions" : "runs"}/${id}`;
  if (row.type === "article") {
    const owner =
      row.runId !== null
        ? "runs"
        : row.projectId !== null && row.sessionId === null
          ? "projects"
          : "sessions";
    href = `/${owner}/${encodeURIComponent(row.runId ?? row.sessionId ?? row.projectId ?? "")}/articles/${encodeURIComponent(row.slug ?? "")}`;
  } else if (row.type === "memory") {
    href = `${row.projectId === null ? "" : `/projects/${encodeURIComponent(row.projectId)}`}/memories/${encodeURIComponent(row.slug ?? "")}`;
  }
  return {
    reference,
    title: boundedText(row.title, 240),
    projectId: row.projectId,
    sessionId: row.sessionId,
    runId: row.runId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt === null ? null : new Date(row.updatedAt).toISOString(),
    href,
  };
}

/** Search saved text and current workflow metadata with explicit scope and continuation. */
export function searchKnowledge(
  deps: SearchDeps,
  input: KnowledgeSearchOptions,
): {
  scope: KnowledgeScope;
  results: KnowledgeHit[];
  nextOffset: number | null;
} {
  const options = searchOptionsSchema.parse(input);
  const projectId = checkScope(deps.db, options.scope);
  if (options.sessionId !== undefined) {
    requireSession(deps.db, options.sessionId, projectId);
  }
  const match = buildMatchExpression(options.query);
  if (match === null) return { scope: options.scope, results: [], nextOffset: null };
  const rows = deps.db.$client
    .query<
      SourceRow & {
        sourceId: string;
        snippet: string;
        matchOffset: number;
      },
      [string, string | null, string | null, string | null, string | null, number, number]
    >(`
    SELECT ${SOURCE_FIELDS}, search_fts.source_id AS sourceId,
      substr(snippet(search_fts, -1, '', '', '…', 32), 1, 600) AS snippet,
      max(0, instr(search_fts.body, snippet(search_fts, 1, '', '', '', 32)) - 1
        + instr(snippet(search_fts, 1, char(57344), char(57345), '', 32), char(57344)) - 33) AS matchOffset
    FROM search_fts ${SOURCE_JOINS}
    WHERE search_fts MATCH ? AND (${LIVE_SOURCES})
      AND (? IS NULL OR COALESCE(a.project_id, owner.project_id, s.project_id, m.project_id) = ?)
      AND (? IS NULL OR s.id = ?)
    ORDER BY bm25(search_fts, 4.0, 1.0), search_fts.entity_type, search_fts.source_id
    LIMIT ? OFFSET ?
  `)
    .all(
      match,
      projectId,
      projectId,
      options.sessionId ?? null,
      options.sessionId ?? null,
      options.limit + 1,
      options.offset,
    );

  const results: KnowledgeHit[] = rows.map((row) => ({
    ...source(
      row,
      row.type === "session"
        ? {
            type: "session",
            id: row.id,
            ...(row.sourceId === row.id
              ? {}
              : { messageId: row.sourceId, offset: row.matchOffset }),
          }
        : { type: row.type, id: row.id },
    ),
    snippet: boundedText(row.snippet, 600),
  }));

  // FTS-ranked records precede the registry's name-ordered substring matches.
  // Count only when a page reaches that boundary; no arbitrary scan cap hides
  // later records, and the same offset can continue through both sources.
  if (results.length <= options.limit && projectId === null && options.sessionId === undefined) {
    const count =
      deps.db.$client
        .query<{ count: number }, [string]>(`
      SELECT count(*) AS count FROM search_fts ${SOURCE_JOINS}
      WHERE search_fts MATCH ? AND (${LIVE_SOURCES})
    `)
        .get(match)?.count ?? 0;
    const query = options.query.trim().toLowerCase();
    const workflows = deps.registry
      .listWorkflows()
      .filter((workflow) =>
        [workflow.name, workflow.description, workflow.group].some((value) =>
          value?.toLowerCase().includes(query),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(
        Math.max(0, options.offset - count),
        Math.max(0, options.offset - count) + options.limit + 1 - results.length,
      );
    for (const workflow of workflows) {
      results.push({
        reference: { type: "workflow", id: workflow.name },
        title: boundedText(workflow.name, 240),
        snippet: boundedText(workflow.description ?? workflow.name, 600),
        projectId: null,
        sessionId: null,
        runId: null,
        createdAt: null,
        updatedAt: null,
        href: `/workflows/${encodeURIComponent(workflow.name)}`,
      });
    }
  }
  return {
    scope: options.scope,
    results: results.slice(0, options.limit),
    nextOffset: results.length > options.limit ? options.offset + options.limit : null,
  };
}

interface SessionRow {
  id: string;
  title: string;
  projectId: string | null;
  createdAt: number;
  messageCount: number;
}

function requireSession(db: KiriDb, id: string, projectId: string | null): SessionRow {
  const row = db.$client
    .query<SessionRow, [string, string | null, string | null]>(`
    SELECT id, substr(COALESCE(title, 'Untitled session'), 1, 240) AS title, project_id AS projectId,
      started_at AS createdAt, (SELECT count(*) FROM messages WHERE session_id = sessions.id) AS messageCount
    FROM sessions WHERE id = ? AND parent_session_id IS NULL AND (? IS NULL OR project_id = ?)
  `)
    .get(id, projectId, projectId);
  if (!row)
    throw new Error(
      "Session not found in the requested scope. Search again for a current reference.",
    );
  return row;
}

/** A text fragment with precise continuation and optional message provenance. */
export interface KnowledgeExcerpt {
  reference: KnowledgeReference;
  text: string;
  offset: number;
  nextOffset: number | null;
  role?: string;
  messageIndex?: number;
  createdAt?: string;
}

/** One bounded read and cursors for earlier/later text in the same scope. */
export interface KnowledgePage {
  source: KnowledgeSource;
  scope: KnowledgeScope;
  excerpts: KnowledgeExcerpt[];
  previous: { reference: KnowledgeReference; offset: number } | null;
  next: { reference: KnowledgeReference; offset: number } | null;
  messageCount?: number;
}

/** Open bounded saved text; session reads never expand tool, reasoning, or image parts. */
export function openKnowledge(deps: SearchDeps, input: KnowledgeOpenOptions): KnowledgePage {
  const options = openOptionsSchema.parse(input);
  const projectId = checkScope(deps.db, options.scope);
  const ref = options.reference;
  if (ref.type === "session") return openSession(deps.db, options, projectId);
  const offset = options.offset ?? 0;
  let metadata: KnowledgeSource;
  let content: string;
  let length: number;
  if (ref.type === "workflow") {
    const workflow = projectId === null ? deps.registry.getWorkflow(ref.id) : undefined;
    if (!workflow) throw new Error("Workflow not found in the requested scope.");
    const body = JSON.stringify(workflow, null, 2);
    const characters = Array.from(body);
    content = characters.slice(offset, offset + options.maxBytes).join("");
    length = characters.length;
    metadata = {
      reference: ref,
      title: boundedText(workflow.name, 240),
      projectId: null,
      sessionId: null,
      runId: null,
      createdAt: null,
      updatedAt: null,
      href: `/workflows/${encodeURIComponent(workflow.name)}`,
    };
  } else {
    // Read canonical records, not cached snippets, so edits and deletions take
    // effect immediately. SQL substr bounds the body crossing into JavaScript.
    const select =
      ref.type === "article"
        ? `SELECT 'article' AS type, a.id, a.name AS title, COALESCE(a.project_id, s.project_id) AS projectId,
          a.session_id AS sessionId, a.run_id AS runId, a.slug, a.created_at AS createdAt,
          NULL AS updatedAt, a.content_md AS body FROM articles a LEFT JOIN sessions s ON s.id = a.session_id
          WHERE a.id = ? AND s.parent_session_id IS NULL`
        : ref.type === "memory"
          ? `SELECT 'memory' AS type, id, name AS title, project_id AS projectId, NULL AS sessionId,
            NULL AS runId, name AS slug, created_at AS createdAt, updated_at AS updatedAt,
            content_md AS body FROM memories WHERE id = ?`
          : `SELECT 'run' AS type, id, workflow_name AS title, NULL AS projectId, NULL AS sessionId,
            id AS runId, NULL AS slug, started_at AS createdAt, NULL AS updatedAt,
            'Status: ' || status || char(10) || COALESCE(summary, 'No saved summary.') AS body FROM runs WHERE id = ?`;
    const row = deps.db.$client
      .query<
        SourceRow & { content: string; length: number },
        [number, number, string, string | null, string | null]
      >(`
      SELECT type, id, substr(title, 1, 240) AS title, projectId, sessionId, runId, slug, createdAt, updatedAt,
        substr(body, ? + 1, ?) AS content, length(body) AS length
      FROM (${select}) WHERE (? IS NULL OR projectId = ?)
    `)
      .get(offset, options.maxBytes, ref.id, projectId, projectId);
    if (!row)
      throw new Error(
        "Knowledge not found in the requested scope. Search again for a current reference.",
      );
    metadata = source(row, ref);
    content = row.content;
    length = row.length;
  }
  if (offset > length)
    throw new Error("Offset is beyond the current document. Open it again from the beginning.");
  const text = boundedText(content, options.maxBytes);
  const end = offset + Array.from(text).length;
  return {
    source: metadata,
    scope: options.scope,
    excerpts: [{ reference: ref, text, offset, nextOffset: end < length ? end : null }],
    previous:
      offset > 0
        ? { reference: ref, offset: Math.max(0, offset - Math.floor(options.maxBytes / 4)) }
        : null,
    next: end < length ? { reference: ref, offset: end } : null,
  };
}

function openSession(
  db: KiriDb,
  options: z.output<typeof openOptionsSchema>,
  projectId: string | null,
): KnowledgePage {
  const ref = options.reference;
  if (ref.type !== "session") throw new Error("Expected a session reference.");
  const session = requireSession(db, ref.id, projectId);
  const anchor =
    ref.messageId === undefined
      ? null
      : db.$client
          .query<{ index: number }, [string, string]>(`
    SELECT "index" FROM messages WHERE id = ? AND session_id = ? AND role IN ('user', 'assistant')
  `)
          .get(ref.messageId, ref.id);
  if (ref.messageId !== undefined && !anchor)
    throw new Error("Message not found in this session. Search again for a current reference.");
  // A first match-open reserves most of the text budget for the match itself.
  // Explicit continuation starts exactly at the referenced message/offset.
  const includePrevious = options.offset === undefined && anchor !== null;
  const before = includePrevious
    ? db.$client
        .query<{ id: string; index: number }, [string, number]>(`
    SELECT id, "index" FROM messages WHERE session_id = ? AND "index" < ? AND role IN ('user', 'assistant')
    ORDER BY "index" DESC, id DESC LIMIT 1
  `)
        .get(ref.id, anchor.index)
    : null;
  const rows = db.$client
    .query<{ id: string; index: number; role: string; createdAt: number }, [string, number]>(`
    SELECT id, "index", role, created_at AS createdAt FROM messages
    WHERE session_id = ? AND "index" >= ? AND role IN ('user', 'assistant')
    ORDER BY "index", id LIMIT 5
  `)
    .all(ref.id, before?.index ?? anchor?.index ?? 0);
  const excerpts: KnowledgeExcerpt[] = [];
  let remaining = options.maxBytes;
  let next: KnowledgePage["next"] = null;
  for (const message of rows) {
    const messageRef: KnowledgeReference = { type: "session", id: ref.id, messageId: message.id };
    const isPrevious = message.id === before?.id;
    const budget = isPrevious ? Math.floor(options.maxBytes / 4) : remaining;
    if (budget < 4) {
      next = { reference: messageRef, offset: 0 };
      break;
    }
    const requestedOffset =
      message.id === ref.messageId || (anchor === null && message.id === rows[0]?.id)
        ? (options.offset ?? ref.offset ?? 0)
        : 0;
    // Only plain user/assistant text enters the excerpt. Extract inside SQLite
    // so large stored tool payloads never enter the retrieval response.
    const row = db.$client
      .query<
        { text: string; length: number; offset: number },
        [number, number, number, number, string]
      >(`
      SELECT substr(body, offset + 1, ?) AS text, length(body) AS length, offset
      FROM (SELECT body, CASE WHEN ? THEN max(0, length(body) - ?) ELSE ? END AS offset
        FROM (SELECT COALESCE((SELECT group_concat(json_extract(part.value, '$.text'), ' ')
          FROM json_each(messages.parts) part WHERE json_extract(part.value, '$.type') = 'text'), '') AS body
          FROM messages WHERE id = ?))
    `)
      .get(budget, isPrevious ? 1 : 0, Math.floor(budget / 4), requestedOffset, message.id);
    if (!row) throw new Error("Message disappeared while opening the session.");
    if (row.offset > row.length)
      throw new Error(
        "Offset is beyond the current message. Search again for a current reference.",
      );
    const text = boundedText(row.text, budget);
    const end = row.offset + Array.from(text).length;
    remaining -= Buffer.byteLength(text);
    excerpts.push({
      reference: messageRef,
      text,
      offset: row.offset,
      nextOffset: end < row.length ? end : null,
      role: message.role,
      messageIndex: message.index,
      createdAt: new Date(message.createdAt).toISOString(),
    });
    if (!isPrevious && end < row.length) {
      next = { reference: messageRef, offset: end };
      break;
    }
  }
  const last = excerpts.at(-1);
  if (next === null && last) {
    const following = db.$client
      .query<{ id: string }, [string, number]>(`
      SELECT id FROM messages WHERE session_id = ? AND "index" > ? AND role IN ('user', 'assistant')
      ORDER BY "index", id LIMIT 1
    `)
      .get(ref.id, last.messageIndex ?? 0);
    if (following)
      next = { reference: { type: "session", id: ref.id, messageId: following.id }, offset: 0 };
  }
  let previous: KnowledgePage["previous"] = null;
  // A match deep in a message leaves a gap even when earlier neighbouring
  // messages are shown. Navigate back into that gap before older neighbours.
  const first =
    excerpts.find(
      (excerpt) =>
        excerpt.reference.type === "session" &&
        excerpt.reference.messageId === ref.messageId &&
        excerpt.offset > 0,
    ) ?? excerpts[0];
  if (first && first.offset > 0) {
    previous = {
      reference: first.reference,
      offset: Math.max(0, first.offset - Math.floor(options.maxBytes / 4)),
    };
  } else if (first) {
    const preceding = db.$client
      .query<{ id: string }, [string, number]>(`
      SELECT id FROM messages WHERE session_id = ? AND "index" < ? AND role IN ('user', 'assistant')
      ORDER BY "index" DESC, id DESC LIMIT 1
    `)
      .get(ref.id, first.messageIndex ?? 0);
    if (preceding)
      previous = { reference: { type: "session", id: ref.id, messageId: preceding.id }, offset: 0 };
  }
  return {
    source: source(
      {
        ...session,
        type: "session",
        sessionId: session.id,
        runId: null,
        slug: null,
        updatedAt: null,
      },
      { type: "session", id: session.id },
    ),
    scope: options.scope,
    messageCount: session.messageCount,
    excerpts,
    previous,
    next,
  };
}
