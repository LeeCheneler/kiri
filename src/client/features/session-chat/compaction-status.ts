import type { DataUIPart, UIDataTypes } from "ai";

/**
 * Read a streamed context-compaction update. Returns whether compaction is active,
 * or null for unrelated and malformed data parts.
 */
export function compactionStatusOf(dataPart: DataUIPart<UIDataTypes>): boolean | null {
  if (dataPart.type !== "data-compaction") return null;
  const { status } = (dataPart.data ?? {}) as { status?: unknown };
  if (status === "started") return true;
  if (status === "finished") return false;
  return null;
}
