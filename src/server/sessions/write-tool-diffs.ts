import { structuredPatch } from "diff";

/**
 * Default cap on the unified diff a write result carries. The diff feeds the
 * app's transcript rendering — never the model — but it is persisted per
 * message, so a wholesale rewrite mustn't bloat the session store.
 */
export const MAX_DIFF_LENGTH = 64 * 1024;

/**
 * A unified diff of a text change — hunk headers and +/-/context lines, no
 * file-name preamble — for the app's transcript to render. The model never
 * receives it: the result's projection strips it, live and from history. Cut
 * at `maxLength` on a line boundary and flagged, so the renderer can say the
 * diff is partial.
 */
export function unifiedDiff(
  before: string,
  after: string,
  maxLength: number,
): { diff: string; diffTruncated?: true } {
  const { hunks } = structuredPatch("", "", before, after);
  const text = hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`,
    )
    .join("\n");
  if (text.length <= maxLength) return { diff: text };
  const cut = text.slice(0, maxLength);
  const lastLine = cut.lastIndexOf("\n");
  return { diff: lastLine > 0 ? cut.slice(0, lastLine) : cut, diffTruncated: true };
}

/**
 * Strip the app-only diff fields from a filesystem write result, leaving the
 * compact metadata the model acts on. The diff exists for the transcript's
 * rendering; to the model it is pure token re-payment — the change it
 * describes is already carried by the tool call's input.
 */
export function compactWriteOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("diff" in output)) return output;
  const { diff: _diff, diffTruncated: _truncated, ...rest } = output as Record<string, unknown>;
  return rest;
}
