import type { MemoryDetail, MemorySummary } from "../../../shared/api/memories.ts";
import type * as store from "../../memories/store.ts";

/** Serialize a memory's index entry. */
export const serializeMemorySummary = (row: store.MemorySummary): MemorySummary => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

/** Serialize a memory in full. The scope it lives in is the address, not part of the body. */
export const serializeMemory = (row: store.Memory): MemoryDetail => ({
  name: row.name,
  description: row.description,
  contentMd: row.contentMd,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
