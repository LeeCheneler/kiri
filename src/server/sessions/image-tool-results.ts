import { type UIMessage, getToolName, isToolUIPart } from "ai";

// The image tools whose results carry an app-only data-URL image payload.
const IMAGE_TOOLS = new Set(["generate_image"]);

/**
 * Strip the app-only image payload from a generate_image result, leaving the
 * compact metadata the model acts on. The data URL exists for the transcript's
 * rendering; to the model it is pure token re-payment — base64 describing
 * pixels it has no use for.
 */
export function compactImageOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("image" in output)) return output;
  const { image: _image, ...rest } = output as Record<string, unknown>;
  return rest;
}

/**
 * Reshape a session's history for sending to the model: drop the image data
 * from each settled generate_image result. A send-time transform like culling
 * and TOON re-encoding — the untouched history still feeds persistence, so the
 * stored transcript keeps its images for the app to render. Pure: a reshaped
 * message is a fresh object, so the caller's array is never mutated.
 */
export function stripImageToolResults(history: UIMessage[]): UIMessage[] {
  return history.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state !== "output-available") return part;
      if (!IMAGE_TOOLS.has(getToolName(part))) return part;
      const compact = compactImageOutput(part.output);
      if (compact === part.output) return part;
      changed = true;
      return { ...part, output: compact };
    });
    return changed ? { ...message, parts } : message;
  });
}
