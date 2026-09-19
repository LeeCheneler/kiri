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

/** Memories response body. */
export type MemoriesResult = { memories: MemorySummary[] };

/** Memory response body. */
export type MemoryResult = { memory: MemoryDetail };

/** PatchMemory request body. */
export type PatchMemoryRequest = { description?: string; contentMd?: string };
