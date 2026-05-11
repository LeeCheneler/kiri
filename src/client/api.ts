/** A single workflow step as seen by the client. */
export type WorkflowStepSummary =
  | { use: string; env?: Record<string, string> }
  | { sh: string; env?: Record<string, string> };

/** Workflow summary as returned by `GET /api/workflows`. */
export interface WorkflowSummary {
  name: string;
  steps: WorkflowStepSummary[];
  gating?: "auto" | "propose";
  schedule?: string;
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
 * One row in the `GET /api/runs` feed. Timestamps are ISO strings (JSON
 * has no Date type); `isInterrupted` is true when no workflow with this
 * name exists in the registry — render the `(deleted)` badge in that case.
 *
 * `summary` carries the trimmed stdout of the workflow's `summarize:`
 * step when one ran successfully — null on workflows without a
 * summarise step, on cancelled runs (the summariser is skipped), and
 * on runs whose summariser failed.
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
    schedule?: string;
    summarize?: WorkflowStepSummary;
  };
  isInterrupted: boolean;
}

/**
 * Materials snapshot persisted with each step. `use:` steps record every
 * file in the bundle directory; `sh:` steps record the inline source.
 */
export type StepMaterials =
  | { kind: "use"; bundle: string; files: Record<string, string> }
  | { kind: "sh"; source: string };

/**
 * One per-step row inside a run detail. Carries the standard envelope
 * (`status`, `output`, `error`, `traces`, `usage`) and the `materials`
 * snapshot of the bytes that produced the step.
 *
 * `isSummary` distinguishes the workflow's `summarize:` execution from
 * a regular pipeline step. The UI hides summariser rows from the main
 * step list and surfaces them in a dedicated section.
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
  usage: unknown;
  materials: StepMaterials;
  isSummary: boolean;
}

/**
 * A run's published artefact as seen by the run-detail consumer. The
 * markdown body lives on the dedicated artefact route — only metadata
 * needed to render the "Published" section row travels with the run.
 */
export interface RunArtefactSummary {
  name: string;
  title: string;
  createdAt: string;
}

/**
 * Full run as returned by `GET /api/runs/:id`: the run row, its
 * pipeline steps ordered by index (publish-step rows filtered out
 * server-side), and any artefacts the run published, ordered by
 * creation time.
 */
export interface RunDetail {
  run: RunListEntry;
  steps: RunStepRow[];
  artefacts: RunArtefactSummary[];
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
