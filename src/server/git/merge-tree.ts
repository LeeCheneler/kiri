import { runGit } from "./run.ts";

/** How many conflicting paths a summary names before it counts the rest. */
const NAMED_CONFLICTS = 5;

// `<mode> <object> <stage>\t<path>` — the conflicted-file entries git lists
// under the merged tree. The informational messages that follow take no such
// shape, so matching the line is enough to tell the two blocks apart.
const CONFLICT_ENTRY = /^\d{6} [0-9a-f]+ [123]\t(.+)$/;

/**
 * The paths merging `head` into `base` would conflict in, computed in `cwd`: an
 * empty array when the two merge cleanly, and null when git could not answer —
 * no merge base, an unreadable ref, or a git too old for `merge-tree
 * --write-tree`. Null is deliberately distinct from clean: a caller reports
 * nothing rather than claiming the merge would work.
 *
 * Nothing is written or checked out; the merge happens entirely in the object
 * store. Both refs are read as they stand right now, so an answer about a
 * remote-tracking ref is only as truthful as the last fetch.
 */
export async function conflictingPaths(
  cwd: string,
  base: string,
  head: string,
): Promise<string[] | null> {
  const merged = await runGit(cwd, "merge-tree", "--write-tree", base, head);
  if (merged.ok) return [];
  const paths = merged.stdout
    .split("\n")
    .map((line) => CONFLICT_ENTRY.exec(line)?.[1])
    .filter((file): file is string => file !== undefined);
  return paths.length === 0 ? null : [...new Set(paths)];
}

/**
 * Conflicting paths as one readable phrase. A conflicted merge stages one entry
 * per side and a wide conflict can run to hundreds of files, so enough of them
 * are named to see the shape of it and the rest become a count.
 */
export const namePaths = (paths: string[]): string =>
  paths.length <= NAMED_CONFLICTS
    ? paths.join(", ")
    : `${paths.slice(0, NAMED_CONFLICTS).join(", ")} and ${paths.length - NAMED_CONFLICTS} more`;
