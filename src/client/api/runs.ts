import type {
  RunCancelResult,
  RunDetail,
  RunStartResult,
  RunsPage,
  RunsQuery,
} from "../../shared/api/runs.ts";
import type * as requests from "../../shared/api/runs.ts";

import { apiFetch, assertOk, json } from "./http.ts";

/**
 * Fetch one page of the run feed. With no arguments returns the first
 * page (default size). Pass `cursor` from the previous page's
 * `nextCursor` to advance; pass `limit` (1–100) to override the page
 * size; pass `workflow` to scope the feed to a single workflow's runs.
 * Throws on non-2xx.
 */
export const fetchRunsPage = async (opts: RunsQuery = {}): Promise<RunsPage> => {
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
    init.body = JSON.stringify({ inputs } satisfies requests.InvokeRunRequest);
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
export const cancelRun = async (id: string): Promise<RunCancelResult> =>
  json<RunCancelResult>(
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
    init.body = JSON.stringify({ inputs } satisfies requests.InvokeRunRequest);
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
    init.body = JSON.stringify({ inputs } satisfies requests.InvokeRunRequest);
    init.headers = { "Content-Type": "application/json" };
  }
  return json<RunStartResult>(
    await apiFetch(
      `/api/runs/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(recId)}/action`,
      init,
    ),
  );
};
