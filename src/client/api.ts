/** Workflow summary as returned by `GET /api/workflows`. */
export interface WorkflowSummary {
  name: string;
  nodes: Array<{ kind: "script"; path: string }>;
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
    nodes: Array<{ kind: "script"; path: string }>;
    gating?: "auto" | "propose";
    schedule?: string;
  };
  isOrphan: boolean;
}

/**
 * One per-node row inside a run detail. Carries the standard envelope
 * (`status`, `output`, `error`, `traces`, `usage`) and the `materials`
 * snapshot of the bytes that produced the node.
 */
export interface RunNodeRow {
  id: string;
  runId: string;
  index: number;
  kind: string;
  status: "running" | "ok" | "failed";
  output: unknown;
  error: { message: string; stack?: string } | null;
  traces: { stdout: string; stderr: string; durationMs: number } | null;
  usage: unknown;
  materials: { source: string };
}

/** Full run as returned by `GET /api/runs/:id`: the run row plus its nodes ordered by index. */
export interface RunDetail {
  run: RunListEntry;
  nodes: RunNodeRow[];
}

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
};

/** Fetch the workflow registry summary. Throws on non-2xx with the server-provided error message. */
export const fetchWorkflows = async (): Promise<WorkflowSummary[]> =>
  json<WorkflowSummary[]>(await fetch("/api/workflows"));

/** Fetch the reverse-chronological run feed. Throws on non-2xx. */
export const fetchRuns = async (): Promise<RunListEntry[]> =>
  json<RunListEntry[]>(await fetch("/api/runs"));

/** Fetch a single run with its per-node envelopes. Throws on non-2xx (including 404 for unknown ids). */
export const fetchRun = async (id: string): Promise<RunDetail> =>
  json<RunDetail>(await fetch(`/api/runs/${id}`));

/**
 * Trigger a manual run for the named workflow. Resolves once the run has
 * finished (the server awaits the runner) — the returned `status` is the
 * terminal status, not "queued".
 */
export const triggerRun = async (name: string): Promise<RunStartResult> =>
  json<RunStartResult>(
    await fetch(`/api/workflows/${encodeURIComponent(name)}/runs`, { method: "POST" }),
  );
