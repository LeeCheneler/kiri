import type {
  MemoriesResult,
  MemoryResult,
  PatchMemoryRequest,
} from "../../shared/api/memories.ts";
import type * as requests from "../../shared/api/memories.ts";

import { apiFetch, assertOk, json } from "./http.ts";

/**
 * Fetch every memory's index entry — name, one-line summary, and last
 * update — alphabetically by name. Throws on non-2xx.
 */
export const fetchMemories = async (): Promise<MemoriesResult> =>
  json<MemoriesResult>(await apiFetch("/api/memories"));

/**
 * Fetch a single memory in full by name. Throws `ApiError` on non-2xx —
 * 400 for a malformed name, 404 when no memory has it.
 */
export const fetchMemory = async (name: string): Promise<MemoryResult> =>
  json<MemoryResult>(await apiFetch(`/api/memories/${encodeURIComponent(name)}`));

/**
 * Update a memory's summary and/or body, returning the updated row. Omitted
 * fields keep their current value. Throws `ApiError` on non-2xx (404 for an
 * unknown name).
 */
export const patchMemory = async (name: string, patch: PatchMemoryRequest): Promise<MemoryResult> =>
  json<MemoryResult>(
    await apiFetch(`/api/memories/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch satisfies requests.PatchMemoryRequest),
    }),
  );

/**
 * Delete a memory permanently. Throws `ApiError` on non-2xx (404 for an
 * unknown name).
 */
export const deleteMemory = async (name: string): Promise<void> => {
  await assertOk(await apiFetch(`/api/memories/${encodeURIComponent(name)}`, { method: "DELETE" }));
};

// The curation surface for one project's memory, mirroring the global
// endpoints a scope up.
const projectMemoryPath = (projectId: string, name: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(name)}`;

/**
 * Fetch a single project-scoped memory in full. Throws `ApiError` on non-2xx
 * — 400 for a malformed name, 404 when either the project or the named
 * memory is missing.
 */
export const fetchProjectMemory = async (projectId: string, name: string): Promise<MemoryResult> =>
  json<MemoryResult>(await apiFetch(projectMemoryPath(projectId, name)));

/**
 * Update a project-scoped memory's summary and/or body, returning the updated
 * row. Omitted fields keep their current value. Throws `ApiError` on non-2xx.
 */
export const patchProjectMemory = async (
  projectId: string,
  name: string,
  patch: PatchMemoryRequest,
): Promise<MemoryResult> =>
  json<MemoryResult>(
    await apiFetch(projectMemoryPath(projectId, name), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch satisfies requests.PatchMemoryRequest),
    }),
  );

/** Delete a project-scoped memory permanently. Throws `ApiError` on non-2xx. */
export const deleteProjectMemory = async (projectId: string, name: string): Promise<void> => {
  await assertOk(await apiFetch(projectMemoryPath(projectId, name), { method: "DELETE" }));
};
