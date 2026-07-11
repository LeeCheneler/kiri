import { type UIMessage, getToolName, isToolUIPart } from "ai";

// The filesystem write tools whose results carry an app-only unified diff.
const DIFF_TOOLS = new Set(["write_file", "edit_file"]);

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

/**
 * Reshape a session's history for sending to the model: drop the diff from
 * each settled write_file / edit_file result. A send-time transform like
 * culling and TOON re-encoding — the untouched history still feeds
 * persistence, so the stored transcript keeps its diffs for the app to
 * render. Pure: a reshaped message is a fresh object, so the caller's array
 * is never mutated.
 */
export function stripWriteToolDiffs(history: UIMessage[]): UIMessage[] {
  return history.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state !== "output-available") return part;
      if (!DIFF_TOOLS.has(getToolName(part))) return part;
      const compact = compactWriteOutput(part.output);
      if (compact === part.output) return part;
      changed = true;
      return { ...part, output: compact };
    });
    return changed ? { ...message, parts } : message;
  });
}
