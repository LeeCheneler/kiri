import type { WorkflowSummary } from "../../shared/api/workflows.ts";
import { apiFetch, json } from "./http.ts";

/** Fetch the workflow registry summary. Throws on non-2xx with the server-provided error message. */
export const fetchWorkflows = async (): Promise<WorkflowSummary[]> =>
  json<WorkflowSummary[]>(await apiFetch("/api/workflows"));
