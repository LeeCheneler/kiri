import type { UIMessage } from "ai";
import { z } from "zod";

/**
 * One value in a step / article / summariser `env:` map. Either a literal
 * string or a structured reference the runner resolves at spawn time: a
 * declared workflow input (against the run's `inputs` snapshot), an earlier
 * step's stdout (by that step's `id`), or an article's markdown
 * (by its `slug`).
 */
export type EnvValue =
  | string
  | { input: string }
  | { step: string; output?: string }
  | { article: string };

/**
 * The `llm:` block of a first-party LLM step. `model` is a `provider:model`
 * id; the prompt is inline (`prompt`) or a workspace-relative file path
 * (`prompt_file`) — exactly one of the two. (Both fields stay optional here:
 * historical definition snapshots can predate the requirement.)
 */
export interface LlmConfigSummary {
  model: string;
  prompt?: string;
  prompt_file?: string;
}

/**
 * A single workflow step as seen by the client. `id` is the optional
 * identifier later steps reference via `{ step: <id> }` env refs, shown
 * beside the step's title when declared. `name` is an optional short label
 * used as the step's title in the Schema tab and run timeline; absent steps
 * fall back to the bundle reference, the script's first line, or the llm
 * model id.
 */
export type WorkflowStepSummary =
  | {
      use: string;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
      outputs?: string[];
    }
  | {
      sh: string;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
      outputs?: string[];
    }
  | {
      llm: LlmConfigSummary;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
    };

/**
 * One `articles:` entry on a workflow summary. `slug` is the URL/identifier;
 * `name` (the display label) is always present — the server applies the
 * schema's titlecase fallback so the client doesn't re-implement it.
 */
export type WorkflowArticleSummary =
  | {
      slug: string;
      name: string;
      description?: string;
      use: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name: string;
      description?: string;
      sh: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name: string;
      description?: string;
      llm: LlmConfigSummary;
      env?: Record<string, EnvValue>;
    };

/**
 * One declared input on a workflow summary. Mirrors the YAML schema:
 * `name` is the identifier referenced from a step's `env:` via
 * `{ input: <name> }`; `description` (when present) renders as help text
 * next to the field; `required` gates submit; `default` pre-fills the
 * modal field at open time. When `options` is defined, the input is a
 * picklist — the modal renders a `<select>` constrained to those values
 * and `default` (if set) is guaranteed to be one of them.
 */
export interface WorkflowInputSummary {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

/** Workflow summary as returned by `GET /api/workflows`. */
export interface WorkflowSummary {
  name: string;
  /** One-line summary rendered as the deck beneath the workflow title; absent when undeclared. */
  description?: string;
  /** Grouping label rendered as the workflow page eyebrow (e.g. "Dev"); absent when undeclared. */
  group?: string;
  /** Defined when the workflow declares an `inputs:` block; absent otherwise. */
  inputs?: WorkflowInputSummary[];
  steps: WorkflowStepSummary[];
  /** Defined when the workflow has at least one `articles:` entry. */
  articles?: WorkflowArticleSummary[];
  /** Defined when the workflow has a `summarize:` step. */
  summarize?: WorkflowStepSummary;
}

/**
 * Result of a manual run trigger: the new run's id and its current status.
 * The server responds the moment the run row is inserted, so the status is
 * `"running"` here — terminal transitions arrive over the SSE event stream.
 */
export interface RunStartResult {
  runId: string;
  status: "running" | "ok" | "failed" | "cancelled";
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
  status: "running" | "ok" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  error: { message: string; stack?: string } | null;
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
  status: "running" | "ok" | "failed" | "cancelled";
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
  error: { message: string; stack?: string } | null;
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
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  } | null;
  isSummary: boolean;
  isArticle: boolean;
}

/**
 * A run's article as seen by the run-detail consumer. The
 * markdown body lives on the dedicated article route — only metadata
 * needed to render the "Articles" section row travels with the run.
 *
 * `heading` is the article body's first markdown `# heading`, derived
 * server-side, or null when the body has no top-level heading. Surfaces
 * that list articles use it as a sub-byline so identically-titled
 * articles from the same workflow are distinguishable.
 */
export interface ArticleSummary {
  slug: string;
  name: string;
  heading: string | null;
  createdAt: string;
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
  actionedRunStatus: "running" | "ok" | "failed" | "cancelled" | null;
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
 * Error thrown for non-2xx responses from kiri's API. Carries the HTTP
 * status so call sites can branch on it (e.g. show a "not found" view on
 * 404) without parsing the message.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const assertOk = async (res: Response): Promise<void> => {
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
};

const json = async <T>(res: Response): Promise<T> => {
  await assertOk(res);
  return (await res.json()) as T;
};

// When the bundle runs from the hosted shell at https://local.kiri.build,
// relative URLs would resolve against that origin and never reach kiri.
// Target the loopback kiri origin explicitly in that case; stay relative
// for localhost so dev (vite proxy) and direct kiri access stay same-origin.
const KIRI_ORIGIN = "http://127.0.0.1:4242";
const apiOrigin =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? ""
    : KIRI_ORIGIN;
const apiUrl = (path: string) => `${apiOrigin}${path}`;

// Identifies this client to the server's CSRF gate. Presence is what matters;
// the value is informational. State-changing endpoints reject requests
// missing this header — kiri's belt-and-braces defence atop the CORS allow-list.
const CLIENT_HEADER_NAME = "X-Kiri-Client";
const CLIENT_HEADER_VALUE = "kiri-ui";

const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set(CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE);
  return fetch(apiUrl(path), { ...init, headers });
};

/** Fetch the workflow registry summary. Throws on non-2xx with the server-provided error message. */
export const fetchWorkflows = async (): Promise<WorkflowSummary[]> =>
  json<WorkflowSummary[]>(await apiFetch("/api/workflows"));

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

/**
 * Fetch one page of the run feed. With no arguments returns the first
 * page (default size). Pass `cursor` from the previous page's
 * `nextCursor` to advance; pass `limit` (1–100) to override the page
 * size; pass `workflow` to scope the feed to a single workflow's runs.
 * Throws on non-2xx.
 */
export const fetchRunsPage = async (
  opts: { cursor?: string; limit?: number; workflow?: string } = {},
): Promise<RunsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.workflow !== undefined) params.set("workflow", opts.workflow);
  const qs = params.toString();
  return json<RunsPage>(await apiFetch(`/api/runs${qs ? `?${qs}` : ""}`));
};

/** Fetch a single run with its per-step envelopes. Throws on non-2xx (including 404 for unknown ids). */
export const fetchRun = async (id: string): Promise<RunDetail> =>
  json<RunDetail>(await apiFetch(`/api/runs/${id}`));

/**
 * One run's article, fetched by `(runId, name)`. Carries the
 * full markdown body for the dedicated article page; the run detail
 * payload only carries summary metadata so its size stays bounded.
 *
 * `heading` is the article body's first markdown `# heading` (null when
 * the body has none), `gitSha`/`gitDirty` mirror the parent run's
 * working-tree state, and `startedAt`/`finishedAt` carry the run's
 * lifecycle timestamps so the article page can render duration without
 * a second fetch.
 */
export interface ArticleDetail {
  id: string;
  runId: string;
  slug: string;
  name: string;
  contentMd: string;
  createdAt: string;
  workflowName: string;
  heading: string | null;
  gitSha: string | null;
  gitDirty: boolean | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Fetch a single article by run id and slug. Throws on
 * non-2xx — 400 for a malformed slug, 404 when either the run or the
 * named article is missing.
 */
export const fetchArticle = async (runId: string, slug: string): Promise<ArticleDetail> =>
  json<ArticleDetail>(
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/articles/${encodeURIComponent(slug)}`),
  );

/**
 * A session-produced article as seen by its article page. Leaner than a
 * run's `ArticleDetail`: a session has no workflow, git state, or run
 * lifecycle to situate the article under — the producing session's id and
 * the article's own timestamp carry the context. `heading` is the body's
 * first markdown `# heading`, derived server-side, or null.
 */
export interface SessionArticleDetail {
  id: string;
  sessionId: string;
  slug: string;
  name: string;
  contentMd: string;
  createdAt: string;
  heading: string | null;
}

/**
 * Fetch a single session-produced article by session id and slug. Throws on
 * non-2xx — 400 for a malformed slug, 404 when either the session or the
 * named article is missing.
 */
export const fetchSessionArticle = async (
  sessionId: string,
  slug: string,
): Promise<SessionArticleDetail> =>
  json<SessionArticleDetail>(
    await apiFetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/articles/${encodeURIComponent(slug)}`,
    ),
  );

/**
 * Fetch the articles a session has written — summary metadata only, oldest
 * first; bodies live on the article detail route. Throws on non-2xx (404
 * when the session doesn't exist).
 */
export const fetchSessionArticles = async (
  sessionId: string,
): Promise<{ articles: ArticleSummary[] }> =>
  json<{ articles: ArticleSummary[] }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/articles`),
  );

/**
 * Trigger a manual run for the named workflow. Resolves the moment the run
 * row is inserted server-side — the returned `status` is `"running"`, and
 * terminal transitions arrive on the SSE event stream. Pass `inputs` to
 * supply values for a workflow declaring an `inputs:` block; the modal
 * collects them and forwards the map verbatim. Omit for workflows without
 * declared inputs. Throws on non-2xx.
 */
export const triggerRun = async (
  name: string,
  inputs?: Record<string, string>,
): Promise<RunStartResult> => {
  const init: RequestInit = { method: "POST" };
  if (inputs !== undefined) {
    init.body = JSON.stringify({ inputs });
    init.headers = { "Content-Type": "application/json" };
  }
  return json<RunStartResult>(
    await apiFetch(`/api/workflows/${encodeURIComponent(name)}/runs`, init),
  );
};

/**
 * Request cancellation of an in-flight run. Resolves on 202 — the server
 * has signalled the child process; the run's terminal `cancelled` status
 * arrives on the SSE event stream. Throws `ApiError` on non-2xx (404 if
 * the run doesn't exist, 409 if it's already terminal).
 */
export const cancelRun = async (id: string): Promise<{ runId: string }> =>
  json<{ runId: string }>(
    await apiFetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  );

/**
 * Permanently delete a finished run. Resolves on 204 — the server has
 * removed the run row, its child steps and articles, and any scratch
 * directory leftover; a `run.deleted` event is published on the bus so
 * live surfaces can drop the row without a refetch. Throws `ApiError`
 * on non-2xx — 404 if the run doesn't exist (or was already deleted),
 * 409 if it's still in flight (caller must cancel first).
 */
export const deleteRun = async (id: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" }));
};

/**
 * Re-trigger a finished run under its existing id. The server wipes the
 * prior step rows, articles, and scratch dir, then re-executes the
 * workflow against the current registry + data-repo HEAD. Resolves the
 * moment the row flips back to `"running"`; terminal transitions arrive
 * on the SSE event stream. Pass `inputs` to supply values for a workflow
 * declaring an `inputs:` block — the rerun modal pre-fills from the prior
 * run's snapshot and forwards the (possibly tweaked) map verbatim. Omit
 * for workflows without declared inputs. Throws `ApiError` on non-2xx —
 * 404 if the run doesn't exist, 409 if it's still in flight or its
 * workflow has been deleted from the registry.
 */
export const rerunRun = async (
  id: string,
  inputs?: Record<string, string>,
): Promise<RunStartResult> => {
  const init: RequestInit = { method: "POST" };
  if (inputs !== undefined) {
    init.body = JSON.stringify({ inputs });
    init.headers = { "Content-Type": "application/json" };
  }
  return json<RunStartResult>(await apiFetch(`/api/runs/${encodeURIComponent(id)}/rerun`, init));
};

/**
 * Action a recommendation: spawn the recommendation's workflow and pin
 * the spawned run id onto the rec row. Resolves on 202 with the new
 * run id; terminal transitions arrive on the SSE event stream. Pass
 * `inputs` to forward the user's (possibly edited) modal values. Throws
 * `ApiError` on non-2xx — 404 if the recommendation isn't on this run,
 * 409 if it has already been actioned or its workflow has been removed
 * from the registry, 400 if the inputs fail the workflow's schema.
 */
export const actionRecommendation = async (
  runId: string,
  recId: string,
  inputs?: Record<string, string>,
): Promise<RunStartResult> => {
  const init: RequestInit = { method: "POST" };
  if (inputs !== undefined) {
    init.body = JSON.stringify({ inputs });
    init.headers = { "Content-Type": "application/json" };
  }
  return json<RunStartResult>(
    await apiFetch(
      `/api/runs/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(recId)}/action`,
      init,
    ),
  );
};

/** A model offered by a configured provider, as returned by `GET /api/models`. */
export interface ModelInfo {
  /** `provider:model` id — ready to start a session against. */
  id: string;
  /** The provider the model came from. */
  provider: string;
  /** Maximum context (input) tokens, when the provider's listing reports it. */
  contextWindow?: number;
  /** Maximum output tokens, when the provider's listing reports it. */
  outputLimit?: number;
  /** What the model produces. Models producing neither text nor images are never listed. */
  output: "text" | "image";
  /** Whether the model accepts image input; absent when the provider's listing doesn't say. */
  imageInput?: boolean;
}

/** A provider whose model listing failed, surfaced so the picker can explain a gap. */
export interface ModelsFailure {
  provider: string;
  reason: string;
}

/** One modality's named model shortcuts, `name → provider:model`, in config order. */
export type ModelShortcuts = Record<string, string>;

/** The configured shortcuts per modality; a modality without shortcuts is absent. */
export interface ModelShortcutsConfig {
  text?: ModelShortcuts;
  image?: ModelShortcuts;
}

/** Available models across configured providers, plus any per-provider failures and the configured shortcuts. */
export interface ModelsResult {
  models: ModelInfo[];
  failures: ModelsFailure[];
  shortcuts?: ModelShortcutsConfig;
}

/** Fetch the models every configured provider offers. Throws on non-2xx. */
export const fetchModels = async (): Promise<ModelsResult> =>
  json<ModelsResult>(await apiFetch("/api/models"));

/** Severity of a config-health check: wired correctly, working-but-reduced, or broken. */
export type ConfigCheckLevel = "ok" | "degraded" | "error";

/** A single configuration-health finding, as returned by `GET /api/config/health`. */
export interface ConfigCheck {
  area: string;
  level: ConfigCheckLevel;
  title: string;
  detail: string;
}

/** The workspace's configuration-health report. */
export interface ConfigHealth {
  checks: ConfigCheck[];
}

/** Fetch the workspace's configuration-health report. Throws on non-2xx. */
export const fetchConfigHealth = async (): Promise<ConfigHealth> =>
  json<ConfigHealth>(await apiFetch("/api/config/health"));

/** Connection state of a configured MCP server, from `GET /api/mcp/servers`. */
export type McpServerState = "connected" | "failed" | "needs-sign-in";

/** A single MCP server's runtime status. */
export interface McpServerStatus {
  name: string;
  type: "stdio" | "http";
  state: McpServerState;
  /** Tools discovered, when connected. */
  toolCount?: number;
  /** Failure reason, when the connection failed. */
  error?: string;
}

/** Per-server MCP status for the UI. */
export interface McpServersResult {
  servers: McpServerStatus[];
}

/** Fetch the per-server MCP status. Throws on non-2xx. */
export const fetchMcpServers = async (): Promise<McpServersResult> =>
  json<McpServersResult>(await apiFetch("/api/mcp/servers"));

/** The URL that begins OAuth sign-in for an MCP `server`, opened in a new browser tab. */
export const mcpAuthStartUrl = (server: string): string =>
  apiUrl(`/api/mcp/${encodeURIComponent(server)}/auth/start`);

/**
 * A tool's standing permission: run without prompting, prompt every call,
 * withhold it, or decide per call (tools without a per-call judgement treat
 * `"auto"` as `"ask"`).
 */
export type McpToolPermission = "allow" | "ask" | "off" | "auto";

/** One tool a connected MCP server exposes, with its standing permission. */
export interface McpTool {
  name: string;
  /** The namespaced `<server>__<tool>` name — the key for setting its permission. */
  namespacedName: string;
  description?: string;
  permission: McpToolPermission;
}

/** A configured MCP server with its connection state and, when connected, its tools. */
export interface McpServerTools {
  name: string;
  type: "stdio" | "http";
  state: McpServerState;
  error?: string;
  tools: McpTool[];
}

/** A built-in kiri session tool that carries a standing permission, keyed by its plain `name`. */
export interface McpBuiltinTool {
  name: string;
  description: string;
  permission: McpToolPermission;
}

/** Per-server tools and permissions for the MCP management page, plus the gated built-in kiri tools. */
export interface McpToolsResult {
  servers: McpServerTools[];
  builtin: McpBuiltinTool[];
}

/** Fetch every configured MCP server with its tools and their standing permissions. Throws on non-2xx. */
export const fetchMcpTools = async (): Promise<McpToolsResult> =>
  json<McpToolsResult>(await apiFetch("/api/mcp/tools"));

/**
 * Set a tool's standing permission by its namespaced `<server>__<tool>` name —
 * `"allow"` runs it without prompting, `"off"` withholds it from the model,
 * `"ask"` clears any recorded decision. Resolves on 204; throws `ApiError` on
 * non-2xx.
 */
export const setToolPermission = async (
  tool: string,
  permission: McpToolPermission,
): Promise<void> => {
  await assertOk(
    await apiFetch("/api/mcp/tool-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, permission }),
    }),
  );
};

/** Session lifecycle status. `idle` is the resting state between turns. */
export type SessionStatus = "running" | "idle" | "failed" | "cancelled";

/** How hard a session's model reasons, lowest to highest. */
export type SessionEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** A session row as returned by the sessions API. */
export interface Session {
  id: string;
  status: SessionStatus;
  /** `provider:model` id the session's turns run against. */
  model: string;
  /** `provider:model` id the session generates images with, or null when image generation is off. */
  imageModel: string | null;
  /** How hard the session's model reasons; applied from the next turn like the model. */
  effort: SessionEffort;
  /** Absolute directory the session works from, or null when no sandbox was configured at create. */
  cwd: string | null;
  /** The session's display name, or null when untitled — lists fall back to the preview. */
  title: string | null;
  /** Whether the user has pinned the session onto the feed's Pinned tab. */
  pinned: boolean;
  /** The parent session this one was spawned from, or null for a top-level session. */
  parentSessionId: string | null;
  /** The parent's spawning tool call, or null for a top-level session. */
  parentToolCallId: string | null;
  startedAt: string;
  /** Set once the session reaches a terminal `failed`/`cancelled`; null while usable. */
  finishedAt: string | null;
  error: unknown;
}

/** A persisted message on a session. `parts` is an AI SDK `UIMessage` parts array. */
export interface SessionMessage {
  id: string;
  sessionId: string;
  index: number;
  role: "user" | "assistant" | "system";
  parts: UIMessage["parts"];
  /** The context footprint after this message's turn; null for user messages and when a provider reported none. */
  contextTokens: number | null;
  createdAt: string;
}

/**
 * A session as it appears in the list: the row plus a `preview` label drawn
 * from its first user message (`null` until one has been sent), which the list
 * leads with as the session's identifier, and the articles it has written —
 * summary metadata only, ordered by creation, so the row can lead with them
 * the way a run row does.
 */
export interface SessionListEntry extends Session {
  preview: string | null;
  articles: ArticleSummary[];
}

/**
 * One page of the reverse-chronological session list. `nextCursor` is the last
 * row's `id` when a further page exists; `null` on the final page.
 */
export interface SessionsPage {
  sessions: SessionListEntry[];
  nextCursor: string | null;
}

/**
 * Fetch one page of the session list, newest first. Pass `cursor` from the
 * previous page's `nextCursor` to advance, `limit` (1–100) to size the page,
 * and `pinned: true` to narrow the page to pinned sessions. Throws on non-2xx.
 */
export const fetchSessionsPage = async (
  opts: { cursor?: string; limit?: number; pinned?: true } = {},
): Promise<SessionsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.pinned) params.set("pinned", "true");
  const qs = params.toString();
  return json<SessionsPage>(await apiFetch(`/api/sessions${qs ? `?${qs}` : ""}`));
};

/**
 * One entry in the unified activity feed: a workflow run or a session, tagged
 * by `kind` so the feed renders the right row. Entries are ordered newest-first
 * by start time across both kinds.
 */
export type ActivityEntry =
  | { kind: "run"; run: RunListEntry }
  | { kind: "session"; session: SessionListEntry };

/**
 * One page of the unified activity feed. `nextCursor` is an opaque token for
 * the next page when a further one exists; `null` on the final page.
 */
export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

/**
 * Fetch one page of the unified activity feed (runs and sessions interleaved),
 * newest first. Pass `cursor` from the previous page's `nextCursor` to advance
 * and `limit` (1–100) to size the page. Throws on non-2xx.
 */
export const fetchActivityPage = async (
  opts: { cursor?: string; limit?: number } = {},
): Promise<ActivityPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return json<ActivityPage>(await apiFetch(`/api/activity${qs ? `?${qs}` : ""}`));
};

/**
 * One piece of a search-result snippet. `match` marks the pieces that hit a
 * query term so the UI can highlight them.
 */
export interface SearchSnippetSegment {
  text: string;
  match: boolean;
}

/** An article search hit. `runId`/`sessionId` name the producer — exactly one is set. */
export interface SearchArticleHit {
  id: string;
  slug: string;
  name: string;
  runId: string | null;
  sessionId: string | null;
  snippet: SearchSnippetSegment[];
}

/** A session search hit: its title (null when untitled), feed preview (may be empty), and the best-ranked matching message. */
export interface SearchSessionHit {
  id: string;
  title: string | null;
  preview: string;
  snippet: SearchSnippetSegment[];
}

/** A run search hit, matched on its summary. */
export interface SearchRunHit {
  id: string;
  workflowName: string;
  snippet: SearchSnippetSegment[];
}

/** A workflow-definition search hit, matched on name/description/group. */
export interface SearchWorkflowHit {
  name: string;
  description?: string;
  group?: string;
}

/** Grouped results from `GET /api/search`. */
export interface SearchResults {
  articles: SearchArticleHit[];
  sessions: SearchSessionHit[];
  runs: SearchRunHit[];
  workflows: SearchWorkflowHit[];
}

/**
 * Search articles, sessions, run summaries, and workflow definitions for `q`.
 * A blank `q` returns empty groups. Throws on non-2xx.
 */
export const fetchSearch = async (q: string): Promise<SearchResults> => {
  const params = new URLSearchParams({ q });
  return json<SearchResults>(await apiFetch(`/api/search?${params}`));
};

/** A session with its ordered messages, as returned by `GET /api/sessions/:id`. */
export interface SessionDetail {
  session: Session;
  messages: SessionMessage[];
}

/** Fetch a single session with its messages. Throws on non-2xx (404 for unknown ids). */
export const fetchSession = async (id: string): Promise<SessionDetail> =>
  json<SessionDetail>(await apiFetch(`/api/sessions/${encodeURIComponent(id)}`));

/**
 * Fetch the child sessions a session's delegate calls have spawned, oldest
 * first. Children are hidden from the list and feed, so this is the transcript's
 * lookup for the session behind a delegate call. Throws on non-2xx.
 */
export const fetchSessionChildren = async (id: string): Promise<Session[]> =>
  (
    await json<{ children: Session[] }>(
      await apiFetch(`/api/sessions/${encodeURIComponent(id)}/children`),
    )
  ).children;

/**
 * Create a session against `model` (a `provider:model` id), returning the new
 * row — navigate to it to start chatting. Pass `imageModel` to start with image
 * generation on. Throws `ApiError` on non-2xx, notably 400 when a model can't
 * be resolved against the provider registry.
 */
export const createSession = async (
  model: string,
  imageModel?: string,
): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(imageModel === undefined ? { model } : { model, imageModel }),
    }),
  );

/**
 * Change a session's model (a `provider:model` id), returning the updated row.
 * The model resolves at the start of each turn, so the change takes effect from
 * the next turn. Throws `ApiError` on non-2xx — 404 for an unknown session, 400
 * when the model can't be resolved against the provider registry.
 */
export const patchSessionModel = async (id: string, model: string): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }),
  );

/**
 * Change the `provider:model` id a session generates images with, or pass
 * `null` to turn image generation off. Resolved when an image is generated,
 * so the change applies to the next generation. Throws `ApiError` on non-2xx
 * — 404 for an unknown session, 400 when the model can't be resolved against
 * the provider registry.
 */
export const patchSessionImageModel = async (
  id: string,
  imageModel: string | null,
): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageModel }),
    }),
  );

/**
 * Change how hard a session's model reasons, returning the updated row.
 * Applied when the next turn maps it to provider reasoning parameters, so the
 * change takes effect from the next turn. Throws `ApiError` on non-2xx (404
 * for an unknown session).
 */
export const patchSessionEffort = async (
  id: string,
  effort: SessionEffort,
): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effort }),
    }),
  );

/**
 * Rename a session, or pass `null` to clear its title back to the untitled
 * fallback, returning the updated row. A display field only — the list, feed,
 * and search results lead with it. Throws `ApiError` on non-2xx (404 for an
 * unknown session).
 */
export const patchSessionTitle = async (
  id: string,
  title: string | null,
): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );

/**
 * Pin or unpin a session, returning the updated row. A display flag only —
 * pinned sessions surface on the feed's Pinned tab. Throws `ApiError` on
 * non-2xx (404 for an unknown session).
 */
export const patchSessionPinned = async (
  id: string,
  pinned: boolean,
): Promise<{ session: Session }> =>
  json<{ session: Session }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }),
  );

/**
 * Request cancellation of a session's in-flight turn. Resolves on 202 — the
 * turn's terminal `cancelled` status arrives on the SSE event stream. Throws
 * `ApiError` on non-2xx (404 unknown session, 409 when no turn is in flight).
 */
export const cancelSession = async (id: string): Promise<{ sessionId: string }> =>
  json<{ sessionId: string }>(
    await apiFetch(`/api/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  );

/**
 * Permanently delete a session and its messages. Resolves on 204 — the server
 * has removed the session row and its messages and published a `session.deleted`
 * event so live surfaces drop the row without a refetch. Throws `ApiError` on
 * non-2xx — 404 if the session doesn't exist (or was already deleted), 409 if a
 * turn is in flight (caller must cancel first).
 */
export const deleteSession = async (id: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }));
};

/**
 * Truncate a session's transcript from `messageId` onward — the server deletes
 * that message and every turn after it, then rebuilds the running token totals.
 * Backs edit-and-resend: roll the conversation back to the edited message before
 * re-running from it. Resolves on 204; throws `ApiError` on non-2xx — 404 (the
 * session or message is unknown), 409 (a turn is in flight; cancel it first).
 */
export const truncateSessionMessages = async (id: string, messageId: string): Promise<void> => {
  await assertOk(
    await apiFetch(
      `/api/sessions/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    ),
  );
};

/**
 * The turn endpoint for a session's `useChat` transport: the origin-aware URL
 * plus the `X-Kiri-Client` header the CSRF gate requires. `useChat` posts only
 * the newest message here; the server loads the prior turns from storage.
 */
export const sessionTurnEndpoint = (
  id: string,
): { url: string; headers: Record<string, string> } => ({
  url: apiUrl(`/api/sessions/${encodeURIComponent(id)}/messages`),
  headers: { [CLIENT_HEADER_NAME]: CLIENT_HEADER_VALUE },
});

/**
 * The resume endpoint for a session's `useChat` reconnect — the origin-aware URL
 * the hook polls on mount when `resume` is set. A safe GET (no CSRF header), it
 * returns the in-flight turn's event-stream to rejoin, or 204 when none is live.
 */
export const sessionStreamEndpoint = (id: string): string =>
  apiUrl(`/api/sessions/${encodeURIComponent(id)}/stream`);

/**
 * The version string this kiri process advertises. Injected at release-time
 * via `bun build --define KIRI_VERSION=…`; falls back to `"dev"` for local
 * `bun start` and tests.
 */
export interface VersionInfo {
  version: string;
}

/** Fetch the running kiri version. Throws on non-2xx. */
export const fetchVersion = async (): Promise<VersionInfo> =>
  json<VersionInfo>(await apiFetch("/api/version"));

/**
 * Minimal projection of GitHub's release object. Only the fields the SPA
 * needs to render an "upgrade available" nudge — the tag for comparison
 * and the html_url for the "view release" link.
 */
export interface LatestRelease {
  tagName: string;
  htmlUrl: string;
}

const LATEST_RELEASE_URL = "https://api.github.com/repos/LeeCheneler/kiri/releases/latest";

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
});

/**
 * Fetch the latest published release from kiri's GitHub repo. Calls the
 * GitHub REST API directly from the browser (CORS-friendly, no token
 * needed for public repos — 60 req/hr per IP is plenty for occasional
 * page loads). Throws on non-2xx so the caller can swallow and hide the
 * upgrade nudge silently.
 */
export const fetchLatestRelease = async (): Promise<LatestRelease> => {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  }
  const parsed = releaseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError("malformed latest-release payload", 502);
  }
  return { tagName: parsed.data.tag_name, htmlUrl: parsed.data.html_url };
};

/** One memory's index entry: everything but the body. */
export interface MemorySummary {
  name: string;
  description: string;
  updatedAt: string;
}

/** A memory in full, as seen by the curation page. */
export interface MemoryDetail {
  name: string;
  description: string;
  contentMd: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch every memory's index entry — name, one-line summary, and last
 * update — alphabetically by name. Throws on non-2xx.
 */
export const fetchMemories = async (): Promise<{ memories: MemorySummary[] }> =>
  json<{ memories: MemorySummary[] }>(await apiFetch("/api/memories"));

/**
 * Fetch a single memory in full by name. Throws `ApiError` on non-2xx —
 * 400 for a malformed name, 404 when no memory has it.
 */
export const fetchMemory = async (name: string): Promise<{ memory: MemoryDetail }> =>
  json<{ memory: MemoryDetail }>(await apiFetch(`/api/memories/${encodeURIComponent(name)}`));

/**
 * Update a memory's summary and/or body, returning the updated row. Omitted
 * fields keep their current value. Throws `ApiError` on non-2xx (404 for an
 * unknown name).
 */
export const patchMemory = async (
  name: string,
  patch: { description?: string; contentMd?: string },
): Promise<{ memory: MemoryDetail }> =>
  json<{ memory: MemoryDetail }>(
    await apiFetch(`/api/memories/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );

/**
 * Delete a memory permanently. Throws `ApiError` on non-2xx (404 for an
 * unknown name).
 */
export const deleteMemory = async (name: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/memories/${encodeURIComponent(name)}`, { method: "DELETE" }));
};
