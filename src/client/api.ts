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

/** Result of a manual run trigger: the new run's id and its terminal status. */
export interface RunStartResult {
  runId: string;
  status: "ok" | "failed";
}

/**
 * One row in the `GET /api/runs` feed. Timestamps are ISO strings (JSON
 * has no Date type); `isOrphan` is true when no workflow with this name
 * exists in the registry — render the `(deleted)` badge in that case.
 */
export interface RunListEntry {
  id: string;
  workflowName: string;
  status: "running" | "ok" | "failed";
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  error: { message: string; stack?: string } | null;
  definitionSnapshot: {
    name: string;
    steps: WorkflowStepSummary[];
    gating?: "auto" | "propose";
    schedule?: string;
  };
  isOrphan: boolean;
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
 */
export interface RunStepRow {
  id: string;
  runId: string;
  index: number;
  kind: string;
  status: "running" | "ok" | "failed";
  output: unknown;
  error: { message: string; stack?: string } | null;
  traces: { stdout: string; stderr: string; durationMs: number } | null;
  usage: unknown;
  materials: StepMaterials;
}

/** Full run as returned by `GET /api/runs/:id`: the run row plus its steps ordered by index. */
export interface RunDetail {
  run: RunListEntry;
  steps: RunStepRow[];
}

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
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

/** Fetch the workflow registry summary. Throws on non-2xx with the server-provided error message. */
export const fetchWorkflows = async (): Promise<WorkflowSummary[]> =>
  json<WorkflowSummary[]>(await fetch(apiUrl("/api/workflows")));

/** Fetch the reverse-chronological run feed. Throws on non-2xx. */
export const fetchRuns = async (): Promise<RunListEntry[]> =>
  json<RunListEntry[]>(await fetch(apiUrl("/api/runs")));

/** Fetch a single run with its per-step envelopes. Throws on non-2xx (including 404 for unknown ids). */
export const fetchRun = async (id: string): Promise<RunDetail> =>
  json<RunDetail>(await fetch(apiUrl(`/api/runs/${id}`)));

/**
 * Trigger a manual run for the named workflow. Resolves once the run has
 * finished (the server awaits the runner) — the returned `status` is the
 * terminal status, not "queued".
 */
export const triggerRun = async (name: string): Promise<RunStartResult> =>
  json<RunStartResult>(
    await fetch(apiUrl(`/api/workflows/${encodeURIComponent(name)}/runs`), { method: "POST" }),
  );
