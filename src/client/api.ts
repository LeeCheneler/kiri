import { z } from "zod";

/**
 * One value in a step / publish / summariser `env:` map. Either a literal
 * string or a structured reference to a declared workflow input. The
 * runner resolves refs against the run's `inputs` snapshot at spawn time.
 */
export type EnvValue = string | { input: string };

/**
 * A single workflow step as seen by the client. `name` is an optional
 * short label used as the step's title in the Schema tab and run timeline;
 * absent steps fall back to the bundle reference or the script's first line.
 */
export type WorkflowStepSummary =
  | { use: string; name?: string; description?: string; env?: Record<string, EnvValue> }
  | { sh: string; name?: string; description?: string; env?: Record<string, EnvValue> };

/**
 * One `publish:` entry on a workflow summary. `title` is always present —
 * the server applies the schema's titlecase fallback so the client doesn't
 * re-implement it.
 */
export type WorkflowPublishSummary =
  | {
      name: string;
      title: string;
      description?: string;
      use: string;
      env?: Record<string, EnvValue>;
    }
  | {
      name: string;
      title: string;
      description?: string;
      sh: string;
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
  /** Defined when the workflow has at least one `publish:` entry. */
  publish?: WorkflowPublishSummary[];
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
 * Snapshotted publish entry on a run row. Carries the *raw* `title` (or
 * `undefined`) as it appeared in the workflow definition at run-start —
 * callers that need a display string resolve via `resolvePublishTitle`.
 */
export type RunPublishSnapshot =
  | {
      name: string;
      title?: string;
      description?: string;
      use: string;
      env?: Record<string, EnvValue>;
    }
  | {
      name: string;
      title?: string;
      description?: string;
      sh: string;
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
 * `definitionSnapshot.publish` is present when the workflow defined a
 * `publish:` array at run-start; absent otherwise. The run detail page
 * uses it to resolve each publish step row's display title by index.
 *
 * `articles` lists the run's published articles ordered by creation
 * time, populated by the server in a single aggregation across the
 * page. Empty for runs that didn't publish anything. The same field
 * powers both feed-row chips and the run detail's Published section
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
    publish?: RunPublishSnapshot[];
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
 * `isSummary` and `isPublish` distinguish summariser and publish rows
 * from regular pipeline steps. The UI hides both from the main step
 * list and surfaces them in dedicated sections — the Summariser
 * execution disclosure and the Publishing / Published sections
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
  error: { message: string; stack?: string } | null;
  traces: { stdout: string; stderr: string; durationMs: number } | null;
  isSummary: boolean;
  isPublish: boolean;
}

/**
 * A run's published article as seen by the run-detail consumer. The
 * markdown body lives on the dedicated article route — only metadata
 * needed to render the "Published" section row travels with the run.
 *
 * `heading` is the article body's first markdown `# heading`, derived
 * server-side, or null when the body has no top-level heading. Surfaces
 * that list articles use it as a sub-byline so identically-titled
 * articles from the same workflow are distinguishable.
 */
export interface ArticleSummary {
  name: string;
  title: string;
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
 * One run's published article, fetched by `(runId, name)`. Carries the
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
  name: string;
  title: string;
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
 * Fetch a single published article by run id and name. Throws on
 * non-2xx — 400 for a malformed name, 404 when either the run or the
 * named article is missing.
 */
export const fetchArticle = async (runId: string, name: string): Promise<ArticleDetail> =>
  json<ArticleDetail>(
    await apiFetch(`/api/runs/${encodeURIComponent(runId)}/published/${encodeURIComponent(name)}`),
  );

/**
 * One entry in the cross-run "recently published" list. Carries only the
 * metadata the right rail renders: the link target (`runId` + `name`),
 * the display `title`, the article body's first markdown `# heading` (or
 * null when the body has none) for use as a sub-byline, the originating
 * `workflowName`, and `createdAt` for the relative timestamp. The full
 * markdown body lives on the dedicated article route.
 */
export interface RecentArticle {
  runId: string;
  name: string;
  title: string;
  heading: string | null;
  workflowName: string;
  createdAt: string;
}

/**
 * Fetch the most recently published articles across all runs, newest
 * first. The server caps the list (currently at 10). Throws on non-2xx.
 */
export const fetchRecentArticles = async (): Promise<RecentArticle[]> =>
  json<RecentArticle[]>(await apiFetch("/api/articles/recent"));

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
