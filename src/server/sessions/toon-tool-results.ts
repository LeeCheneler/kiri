import { encode } from "@toon-format/toon";
import { type UIMessage, isToolUIPart } from "ai";

/**
 * Re-encode a tool result's JSON `output` as TOON when that is the smaller
 * form, returning the TOON string to put in its place — or undefined to leave
 * the result as JSON. The AI SDK sends a string tool output verbatim as text
 * while serialising an object/array as JSON, so swapping an object for its TOON
 * string makes the model receive the compact text instead.
 *
 * TOON only wins on structured/tabular data — a uniform array of short-field
 * records collapses to a header plus one row each; for prose-heavy output its
 * structural savings are noise and the JSON is already about as tight. So the
 * swap is taken only when the TOON is strictly shorter, decided per result, so
 * it never makes a result larger. The encoding is lossless by the library's
 * design (covered by a round-trip test), so the model reads back the same data.
 *
 * Only objects and arrays are candidates — a string output is already sent as
 * text, and a scalar gains nothing. The output always originates as persisted
 * JSON, so it is serialisable and TOON-encodable without throwing.
 */
export function toonEncodeIfSmaller(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const toon = encode(output);
  if (toon.length >= JSON.stringify(output).length) return undefined;
  return toon;
}

/**
 * Reshape a session's history for sending to the model: re-encode each settled
 * tool result's JSON output as TOON wherever that is the smaller form (see
 * `toonEncodeIfSmaller`). A send-time transform — the untouched history still
 * feeds persistence, so the stored messages and transcript stay as JSON,
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
