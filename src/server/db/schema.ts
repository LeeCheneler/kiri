import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * One row per workflow invocation. `definition_snapshot` captures the
 * resolved workflow definition at run start so feed entries always reflect
 * the exact code that ran, even after the workflow file changes or is
 * deleted.
 */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  workflowName: text("workflow_name").notNull(),
  /**
   * Run lifecycle: `"running"` at insert → `"ok"`, `"failed"`, or
   * `"cancelled"` when the runner finalizes. Feed-view consumers must
   * handle all four states — in-flight rows render as live runs.
   */
  status: text("status").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  error: text("error", { mode: "json" }),
  definitionSnapshot: text("definition_snapshot", { mode: "json" }).notNull(),
  /**
   * Trimmed stdout of the workflow's `summarize:` step, when one is
   * configured and exits successfully. Null on workflows without a
   * summarize step, on cancelled runs (where the summariser is skipped),
   * and on runs whose summariser failed.
   */
  summary: text("summary"),
  /**
   * HEAD commit of the data repo at run-start. Null when the data
   * directory is not a git repo or has no commits yet. Paired with
   * `gitDirty` so consumers can render "ran at <sha> (dirty)" and
   * reproduce the run state with `git checkout`.
   */
  gitSha: text("git_sha"),
  /**
   * Whether the working tree had uncommitted changes at run-start.
   * Null when `gitSha` is null (no repo to compare against).
   */
  gitDirty: integer("git_dirty", { mode: "boolean" }),
  /**
   * Resolved input values captured at run-start. Null when the workflow
   * declared no `inputs:` block; otherwise a `Record<string, string>` with
   * one entry per declared input that resolved to a value (supplied at
   * invoke, or via the input's `default`). Step `env:` references of the
   * form `{ input: <name> }` resolve against this snapshot at spawn.
   */
  inputs: text("inputs", { mode: "json" }),
});

/**
 * Per-step state for a run. Carries the standard envelope: `status`,
 * `output`, `error`, `traces`. Reproducibility of the source bytes
 * that produced the step lives on `runs.gitSha` — the data repo
 * commit at run-start — rather than per-step file snapshots.
 */
export const runSteps = sqliteTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    index: integer("index").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    /**
     * Wall-clock span of the step's execution: `startedAt` is stamped at
     * insert (when the row is first written as `running`); `finishedAt` is
     * stamped at the terminal update. Their difference is the duration the
     * UI shows once a step completes, and `startedAt` alone anchors the live
     * elapsed timer while it runs. Both nullable: rows predating these
     * columns have neither, and a running row carries `startedAt` with no
     * `finishedAt` yet.
     */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /**
     * Step output. `mode: "json"` round-trips through `JSON.stringify`, so
     * a string lands in the cell *quoted* (drizzle re-parses on read;
     * matters only for raw SQL inspection).
     */
    output: text("output", { mode: "json" }),
    /**
     * Named values the step emitted via its outputs channel, as a
     * `Record<string, string>` keyed by declared output name. Null for
     * steps that declare no `outputs:` (and rows predating the column).
     */
    outputs: text("outputs", { mode: "json" }),
    error: text("error", { mode: "json" }),
    traces: text("traces", { mode: "json" }),
    /**
     * Marks the row as the workflow's `summarize:` execution rather than
     * a member of the `steps:` pipeline. Set on the single summariser row
     * a run produces; the UI hides these from the main step list and
     * surfaces them in a dedicated section.
     */
    isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
    /**
     * Marks the row as one of the workflow's `articles:` executions rather
     * than a member of the `steps:` pipeline. Set on each article row a
     * run produces; the UI hides these from the main step list and
     * surfaces them via the article view.
     */
    isArticle: integer("is_article", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("run_steps_run_id_idx").on(t.runId)],
);

/**
 * One row per article, linked to exactly one producer: the workflow run or
 * the agentic session that wrote it (`runId` XOR `sessionId`, enforced by a
 * check constraint). Run articles are populated after `steps:` complete
 * (when the workflow defines `articles:`) and read back to render article
 * chips on the feed and the dedicated article page. `slug` is the
 * URL/identifier, unique within its producer; `name` is the resolved
 * display label — never null — so write-time titlecasing doesn't leak into
 * read paths.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => runs.id),
    sessionId: text("session_id").references(() => sessions.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    contentMd: text("content_md").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("articles_run_id_slug_unique").on(t.runId, t.slug).where(sql`"run_id" is not null`),
    uniqueIndex("articles_session_id_slug_unique")
      .on(t.sessionId, t.slug)
      .where(sql`"session_id" is not null`),
    index("articles_run_id_idx").on(t.runId),
    index("articles_session_id_idx").on(t.sessionId),
    check("articles_producer_check", sql`("run_id" is not null) <> ("session_id" is not null)`),
  ],
);

/**
 * One proposed follow-up workflow invocation emitted by a run. Rows are
 * created at step-completion time from the step's recommendations file
 * channel; reads power the run detail page's "Recommended" section.
 * `actionedRunId` + `actionedAt` move from null to populated when the
 * user triggers the recommendation and link to the spawned run.
 */
export const recommendations = sqliteTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    /** Emission order within the producing run. */
    index: integer("index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Name of the workflow to invoke when the recommendation is actioned. */
    workflow: text("workflow").notNull(),
    /** Pre-fills for the invoke modal. `Record<string, string>` keyed by input name. */
    inputs: text("inputs", { mode: "json" }),
    actionedRunId: text("actioned_run_id").references(() => runs.id),
    actionedAt: integer("actioned_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("recommendations_run_id_idx").on(t.runId),
    index("recommendations_actioned_run_id_idx").on(t.actionedRunId),
  ],
);

/**
 * One row per agentic conversation — the session pillar's instance, mirroring
 * `runs`. A session runs against a chosen `model`; the rest of the agent
 * layer (allowed tools, generation params) is not modelled here yet.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    /**
     * Session lifecycle: `"idle"` at create and between turns, `"running"`
     * while a turn streams, and terminal `"failed"` / `"cancelled"` when a
     * turn errors or is cancelled. Unlike a run, a session is long-lived —
     * it returns to `"idle"` after each successful turn rather than reaching
     * a single terminal state.
     */
    status: text("status").notNull(),
    /** `provider:model` id the session's turns run against, resolved through the same registry `llm:` steps use. */
    model: text("model").notNull(),
    /**
     * `provider:model` id of the image-generation model the session generates
     * images with, or null when image generation is off. A selection reference
     * like `model` — resolved when an image is generated, so a change applies
     * to the next generation.
     */
    imageModel: text("image_model"),
    /**
     * Whether the user has pinned the session. A display flag only — pinned
     * sessions surface on the feed's Pinned tab; execution is unaffected.
     */
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /**
     * The parent session this one was spawned from, or null for a top-level
     * session. A non-null parent is the marker that this session is a
     * delegated worker: it runs the focused worker system prompt and is never
     * offered session-spawning tools. Children are filtered out of the feed
     * and session lists.
     */
    parentSessionId: text("parent_session_id").references((): AnySQLiteColumn => sessions.id),
    /**
     * The id of the parent's tool call that spawned this child, or null for a
     * top-level session. Lets the parent transcript re-attach a running child
     * to the exact tool-call block it belongs to after a reload.
     */
    parentToolCallId: text("parent_tool_call_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    /** Stamped when the session reaches a terminal `failed`/`cancelled` state; null while it remains usable. */
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    error: text("error", { mode: "json" }),
  },
  (t) => [index("sessions_parent_session_id_idx").on(t.parentSessionId)],
);

/**
 * One row per message in a session, ordered by `index`. `parts` holds the
 * AI SDK `UIMessage` parts array as JSON — text, tool-call, tool-result,
 * file/image, reasoning — the canonical, provider-agnostic representation
 * the client renders and `convertToModelMessages` round-trips to the model.
 * Storing parts is what makes later tools and image uploads storage no-ops:
 * they are simply additional part types this column already holds. Each
 * assistant message records the context footprint it settled at in
 * `context_tokens`.
 */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    /** Order within the session, assistant and user messages alike. */
    index: integer("index").notNull(),
    /** `"user"` | `"assistant"` | `"system"`, matching the `UIMessage` role. */
    role: text("role").notNull(),
    parts: text("parts", { mode: "json" }).notNull(),
    /**
     * The context footprint once the turn that produced this message settled —
     * its last model call's total tokens. Null for user messages and for
     * assistant messages a provider returned no counts for. The session's live
     * context fill reads the most recent message that carries one.
     */
    contextTokens: integer("context_tokens"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("messages_session_id_idx").on(t.sessionId)],
);
