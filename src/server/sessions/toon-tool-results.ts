import { decode, encode } from "@toon-format/toon";
import { type UIMessage, isToolUIPart } from "ai";

/**
 * Re-encode a settled tool result's JSON `output` as TOON when that is the
 * leaner form, returning the TOON string to put in its place — or undefined to
 * leave the result as JSON. The AI SDK sends a string tool output verbatim as
 * text while serialising an object/array as JSON, so swapping an object for its
 * TOON string makes the model receive the compact text instead.
 *
 * Two guards keep the swap safe, both decided per result so it never backfires:
 *
 * - **Never larger.** TOON only wins on structured/tabular data (a uniform array
 *   of short-field records collapses to a header plus rows); for prose-heavy
 *   output its structural savings are noise. So we keep TOON only when it is
 *   actually shorter than the JSON, deciding per result rather than wholesale.
 * - **Lossless.** The emitted TOON must decode back to the original JSON. We
 *   verify the round-trip rather than trust the encoder, so a result is only
 *   ever re-encoded when the model would read back exactly the same data.
 *
 * Only objects and arrays are candidates — a string output is already sent as
 * text, and a scalar gains nothing. Anything that throws or fails a guard is
 * left untouched (returns undefined).
 */
export function toonEncodeIfSmaller(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const json = JSON.stringify(output);
  if (json === undefined) return undefined;
  try {
    const toon = encode(output);
    if (toon.length >= json.length) return undefined;
    if (JSON.stringify(decode(toon)) !== json) return undefined;
    return toon;
  } catch {
    return undefined;
  }
}

/**
 * Reshape a session's history for sending to the model: re-encode each settled
 * tool result's JSON output as TOON wherever that is the smaller, lossless form
 * (see `toonEncodeIfSmaller`). A send-time transform — the untouched history
 * still feeds persistence, so the stored messages and transcript stay as JSON,
 * mirroring how tool-result culling works. Pure: a re-encoded message is a fresh
 * object, so the caller's array — reused for persistence — is never mutated.
 */
export function toonEncodeToolResults(history: UIMessage[]): UIMessage[] {
  return history.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state !== "output-available") return part;
      const toon = toonEncodeIfSmaller(part.output);
      if (toon === undefined) return part;
      changed = true;
      return { ...part, output: toon };
    });
    return changed ? { ...message, parts } : message;
  });
}
