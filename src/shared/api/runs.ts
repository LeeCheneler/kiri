import type { ExecutionError } from "./errors.ts";
import type { PageQuery } from "./pagination.ts";
/** Lifecycle of a workflow run. */
export type RunStatus = "running" | "ok" | "failed" | "cancelled";
/** Lifecycle of a workflow step. */
export type StepStatus = RunStatus;
import type { ArticleSummary } from "./articles.ts";
import type { EnvValue, LlmConfigSummary, WorkflowStepSummary } from "./workflows.ts";

/**
 * Result of a manual run trigger: the new run's id and its current status.
 * The server responds the moment the run row is inserted, so the status is
 * `"running"` here — terminal transitions arrive over the SSE event stream.
 */
export interface RunStartResult {
  runId: string;
  status: RunStatus;
}

/**
 * Snapshotted article entry on a run row. Carries the *raw* `name` label (or
 * `undefined`) as it appeared in the workflow definition at run-start —
 * callers that need a display string resolve via `resolveArticleName`.
 */
export type RunArticleSnapshot =
  | {
      slug: string;
      name?: string;
      description?: string;
      use: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name?: string;
      description?: string;
      sh: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name?: string;
      description?: string;
      llm: LlmConfigSummary;
      env?: Record<string, EnvValue>;
    };

/**
 * One row in the `GET /api/runs` feed. Timestamps are ISO strings (JSON
 * has no Date type); `isInterrupted` is true when no workflow with this
 * name exists in the registry — render the `(deleted)` badge in that case.
 *
 * `summary` carries the trimmed stdout of the workflow's `summarize:`
 * step when one ran successfully — null on workflows without a
 * summarise step, on cancelled runs (the summariser is skipped), and
 * on runs whose summariser failed.
 *
 * `definitionSnapshot.articles` is present when the workflow defined a
 * `articles:` array at run-start; absent otherwise. The run detail page
 * uses it to resolve each article step row's display title by index.
 *
 * `articles` lists the run's articles ordered by creation
 * time, populated by the server in a single aggregation across the
 * page. Empty for runs that produced no articles. The same field
 * powers both feed-row chips and the run detail's Articles section
 * so consumers read from one place.
 *
 * `recommendationsCount` is the run's emitted-recommendation total,
 * populated by the server in a single grouped aggregation across the
 * page. The feed surfaces it as a "N recommendations" marker in the
 * row's byline when greater than zero. The full array lives on the
 * detail response under `recommendations` — only the count travels
 * with feed rows.
 */
export interface RunListEntry {
  id: string;
  workflowName: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: ExecutionError | null;
  summary: string | null;
  definitionSnapshot: {
    name: string;
    steps: WorkflowStepSummary[];
    summarize?: WorkflowStepSummary;
    articles?: RunArticleSnapshot[];
  };
  /**
   * HEAD sha of the data repo at run-start, with a dirty flag for
   * uncommitted changes. Both null when the data dir is not a git repo
   * or has no commits.
   */
  gitSha: string | null;
  gitDirty: boolean | null;
  /**
   * Resolved input values captured at run-start. Null when the workflow
   * declared no `inputs:` block; otherwise a `Record<string, string>` with
   * one entry per declared input that resolved to a value (supplied at
   * invoke, or via the input's `default`).
   */
  inputs: Record<string, string> | null;
  isInterrupted: boolean;
  articles: ArticleSummary[];
  recommendationsCount: number;
}

/**
 * One per-step row inside a run detail. Carries the standard envelope:
 * `status`, `output`, `error`, `traces`. Reproducibility of the bytes
 * that produced the step lives on the parent run's `gitSha`.
 *
 * `isSummary` and `isArticle` distinguish summariser and article rows
 * from regular pipeline steps. The UI hides both from the main step
 * list and surfaces them in dedicated sections — the Summariser
 * execution disclosure and the article sections
 * respectively.
 */
export interface RunStepRow {
  id: string;
  runId: string;
  index: number;
  kind: string;
  status: RunStatus;
  /**
   * ISO timestamps bounding the step's execution: `startedAt` is captured
   * when the row is first written, `finishedAt` at its terminal update.
   * Their difference is the duration shown once the step completes, and
   * `startedAt` anchors the live elapsed timer while it runs. Both null only
   * for rows predating per-step timing; a `running` row carries `startedAt`
   * with a null `finishedAt`.
   */
  startedAt: string | null;
  finishedAt: string | null;
  output: unknown;
  /**
   * Named values the step emitted through its `outputs:` channel, keyed by
   * declared name. Null for steps that declare no outputs (and rows
   * predating the channel).
   */
  outputs: Record<string, string> | null;
  error: ExecutionError | null;
  /**
   * Captured execution traces, or null for rows predating trace capture.
   * `usage` carries per-call token counts on `llm:` step rows (a single
   * non-streaming completion); absent on script/bundle rows and on llm rows
   * whose provider reported no usage.
   */
  traces: {
    stdout: string;
    stderr: string;
    durationMs: number;
    /**
     * stdout and stderr merged in arrival order — the step's output as a
     * terminal would have shown it. Tail-capped while the step runs, full
     * once it settles. Absent only on rows predating merged capture.
     */
    console?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  } | null;
  isSummary: boolean;
  isArticle: boolean;
}

/**
 * One follow-up workflow invocation a run has proposed, as seen by the
 * run-detail consumer. `actionedRunId` + `actionedAt` are null until the
 * user triggers the recommendation; `actionedRunStatus` ships the target
 * run's lifecycle status so the trigger button can render as a
 * status-badged link without an extra round-trip.
 */
export interface RecommendationSummary {
  id: string;
  index: number;
  title: string;
  description: string | null;
  workflow: string;
  inputs: Record<string, string> | null;
  actionedRunId: string | null;
  actionedAt: string | null;
  actionedRunStatus: RunStatus | null;
}

/**
 * The run row as returned on `GET /api/runs/:id`. Extends the feed-row
 * shape with the per-run `recommendations` array (the list endpoint
 * omits this — only the count travels with feed rows).
 */
export type RunDetailRun = RunListEntry & { recommendations: RecommendationSummary[] };

/**
 * Full run as returned by `GET /api/runs/:id`: the run row (which
 * carries its articles and recommendations, ordered by creation time
 * and emission index respectively) and its pipeline steps ordered by
 * index.
 */
export interface RunDetail {
  run: RunDetailRun;
  steps: RunStepRow[];
}

/**
 * One page of the reverse-chronological run feed. `nextCursor` is the
 * last row's `id` when a further page is available; `null` when this is
 * the final page. Pass it back as the `cursor` query param to load the
 * next page.
 */
export interface RunsPage {
  runs: RunListEntry[];
  nextCursor: string | null;
}

/** RunCancel response body. */
export type RunCancelResult = { runId: string };

/** InvokeRun request body. */
export type InvokeRunRequest = { inputs?: Record<string, string> };

/** Run-list filters and pagination. */
export interface RunsQuery extends PageQuery {
  workflow?: string;
}
