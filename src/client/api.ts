/** A single workflow step as seen by the client. */
export type WorkflowStepSummary =
  | { use: string; description?: string; env?: Record<string, string> }
  | { sh: string; description?: string; env?: Record<string, string> };

/**
 * One `publish:` entry on a workflow summary. `title` is always present —
 * the server applies the schema's titlecase fallback so the client doesn't
 * re-implement it.
 */
export type WorkflowPublishSummary =
  | { name: string; title: string; description?: string; use: string; env?: Record<string, string> }
  | {
      name: string;
      title: string;
      description?: string;
      sh: string;
      env?: Record<string, string>;
    };

/** Workflow summary as returned by `GET /api/workflows`. */
export interface WorkflowSummary {
  name: string;
  steps: WorkflowStepSummary[];
  gating?: "auto" | "propose";
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
      env?: Record<string, string>;
    }
  | {
      name: string;
      title?: string;
      description?: string;
      sh: string;
      env?: Record<string, string>;
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
 */
export interface RunListEntry {
  id: string;
  workflowName: string;
  status: "running" | "ok" | "failed" | "cancelled";
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  error: { message: string; stack?: string } | null;
  summary: string | null;
  definitionSnapshot: {
    name: string;
    steps: WorkflowStepSummary[];
    gating?: "auto" | "propose";
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
  isInterrupted: boolean;
  articles: ArticleSummary[];
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
 */
export interface ArticleSummary {
  name: string;
  title: string;
  createdAt: string;
}

/**
 * Full run as returned by `GET /api/runs/:id`: the run row (which
 * carries its articles on `run.articles`, ordered by creation time)
 * and its pipeline steps ordered by index.
 */
export interface RunDetail {
  run: RunListEntry;
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

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
  }
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
 * size. Throws on non-2xx.
 */
export const fetchRunsPage = async (
  opts: { cursor?: string; limit?: number } = {},
): Promise<RunsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor !== undefined) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
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
 */
export interface ArticleDetail {
  id: string;
  runId: string;
  name: string;
  title: string;
  contentMd: string;
  createdAt: string;
  workflowName: string;
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
 * the display `title`, the originating `workflowName`, and `createdAt`
 * for the relative timestamp. The markdown body lives on the dedicated
 * article route.
 */
export interface RecentArticle {
  runId: string;
  name: string;
  title: string;
  workflowName: string;
  createdAt: string;
}

/**
 * Fetch the most recently published articles across all runs, newest
 * first. The server caps the list (currently at 5). Throws on non-2xx.
 */
export const fetchRecentArticles = async (): Promise<RecentArticle[]> =>
  json<RecentArticle[]>(await apiFetch("/api/articles/recent"));

/**
 * Trigger a manual run for the named workflow. Resolves the moment the run
 * row is inserted server-side — the returned `status` is `"running"`, and
 * terminal transitions arrive on the SSE event stream. Throws on non-2xx.
 */
export const triggerRun = async (name: string): Promise<RunStartResult> =>
  json<RunStartResult>(
    await apiFetch(`/api/workflows/${encodeURIComponent(name)}/runs`, { method: "POST" }),
  );

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
  const res = await apiFetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
  }
};

/**
 * Re-trigger a finished run under its existing id. The server wipes the
 * prior step rows, articles, and scratch dir, then re-executes the
 * workflow against the current registry + data-repo HEAD. Resolves the
 * moment the row flips back to `"running"`; terminal transitions arrive
 * on the SSE event stream. Throws `ApiError` on non-2xx — 404 if the run
 * doesn't exist, 409 if it's still in flight or its workflow has been
 * deleted from the registry.
 */
export const rerunRun = async (id: string): Promise<RunStartResult> =>
  json<RunStartResult>(
    await apiFetch(`/api/runs/${encodeURIComponent(id)}/rerun`, { method: "POST" }),
  );

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
  const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof body.tag_name !== "string" || typeof body.html_url !== "string") {
    throw new ApiError("malformed latest-release payload", 502);
  }
  return { tagName: body.tag_name, htmlUrl: body.html_url };
};
