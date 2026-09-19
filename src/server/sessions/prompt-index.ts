/**
 * The ceiling on an index the system prompt carries — the saved memories, a
 * project's articles. An index rides in every request and no compaction can
 * remove it, so it lists a bounded number of entries and names the rest by
 * count; standing instructions are not an index and are never held to it.
 */

/** The most entries one prompt index lists. */
export const INDEX_ENTRY_LIMIT = 50;

/** The longest title or summary an index entry carries before it is cut. */
export const INDEX_TEXT_LIMIT = 160;

/** A prompt index: the entries it lists, and how many more exist beyond them. */
export interface PromptIndex<T> {
  entries: readonly T[];
  omitted: number;
}

/** A complete list read as an index that omits nothing; an index passes through. */
export function asPromptIndex<T>(index: readonly T[] | PromptIndex<T>): PromptIndex<T> {
  return "omitted" in index ? index : { entries: index, omitted: 0 };
}

/** The index over `listed` when `total` entries exist: whatever was not listed is omitted. */
export function promptIndex<T>(listed: readonly T[], total: number): PromptIndex<T> {
  return { entries: listed, omitted: Math.max(0, total - listed.length) };
}

/**
 * An entry's title or summary as the index shows it: one line, cut with an
 * ellipsis past the limit. Identifiers are never passed through here — a cut
 * slug or name could not be read back.
 */
export function indexText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > INDEX_TEXT_LIMIT ? `${line.slice(0, INDEX_TEXT_LIMIT).trimEnd()}…` : line;
}
