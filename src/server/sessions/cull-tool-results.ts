import { type UIMessage, isToolUIPart } from "ai";
import type { Message } from "./store.ts";

/**
 * Above this fraction of the model's context window, older tool results are
 * culled from the history sent to the model. A late trigger keeps culling a
 * last-resort valve: below it every result stays at full fidelity, and the
 * remaining fifth of the window is still room for the turn's reply and any
 * further tool calls it makes this turn.
 */
export const CONTEXT_CULL_RATIO = 0.8;

/** How many of the most recent tool results survive a cull at full fidelity. */
export const KEEP_RECENT_TOOL_RESULTS = 3;

/**
 * Tool parts whose results are never culled, by UI part type. A delegate
 * result is a worker session's distilled report — the findings the delegation
 * spent a whole child context producing — and re-running one is slow, costly,
 * and not guaranteed to reach the same conclusions, so it must outlive any
 * cull. (The part type embeds the tool name; the delegate tool's own module
 * sits above this one in the import graph, so the name can't be imported.)
 */
export const CULL_EXEMPT_TOOL_TYPES: ReadonlySet<string> = new Set(["tool-delegate"]);

/**
 * Stands in for a culled tool result in the history sent to the model. The tool
 * call — its name and arguments — is kept so the model still sees what it ran;
 * only the result payload, often the bulk of the context, is replaced by this.
 */
export const CULLED_RESULT_NOTICE =
  "[Earlier tool result removed from history to conserve context — re-run the tool if you need this output again.]";

/**
 * The live context fill: the most recent settled turn's recorded context
 * footprint — its last model call's total tokens. Mirrors the client's
 * `currentContextTokens`. Undefined until a turn has settled with a footprint
 * (a brief gap a fresh turn fills), so the first turn of a session never culls.
 */
export function currentContextTokens(rows: Message[]): number | undefined {
  return rows.findLast((row) => row.contextTokens != null)?.contextTokens ?? undefined;
}

/**
 * Reshape a session's history for sending to the model: once context fill is
 * over `CONTEXT_CULL_RATIO` of the window, replace the result of every tool call
 * except the most recent `KEEP_RECENT_TOOL_RESULTS` with `CULLED_RESULT_NOTICE`,
 * keeping each call's invocation intact. Results of `CULL_EXEMPT_TOOL_TYPES`
 * are never culled and never count toward the kept recents. Returns the history unchanged when the
 * window or fill is unknown, when fill is within budget, or when there are no
 * more tool results than we keep. Pure: a culled message is a fresh object, so
 * the caller's array — reused for persistence — is never mutated.
 */
export function cullToolHistory(
  history: UIMessage[],
  opts: { contextTokens?: number; contextWindow?: number },
): UIMessage[] {
  const { contextTokens, contextWindow } = opts;
  if (contextWindow === undefined || contextTokens === undefined) return history;
  if (contextTokens <= contextWindow * CONTEXT_CULL_RATIO) return history;
  return cullOlderToolResults(history, KEEP_RECENT_TOOL_RESULTS);
}

// Replace the `output` of every settled tool result bar the last `keep` with the
// notice. Pending, errored, exempt, and non-tool parts are left untouched —
// exempt results don't spend a keep slot either — and "the last `keep`" is
// counted across the flattened tool-result sequence over all messages — a
// turn's multi-step loop can land several results in one assistant message.
function cullOlderToolResults(history: UIMessage[], keep: number): UIMessage[] {
  const positions: string[] = [];
  history.forEach((message, mi) => {
    message.parts.forEach((part, pi) => {
      if (
        isToolUIPart(part) &&
        part.state === "output-available" &&
        !CULL_EXEMPT_TOOL_TYPES.has(part.type)
      )
        positions.push(`${mi}:${pi}`);
    });
  });
  if (positions.length <= keep) return history;
  const culled = new Set(positions.slice(0, positions.length - keep));

  return history.map((message, mi) => {
    if (!message.parts.some((_, pi) => culled.has(`${mi}:${pi}`))) return message;
    return {
      ...message,
      parts: message.parts.map((part, pi) =>
        culled.has(`${mi}:${pi}`) && isToolUIPart(part) && part.state === "output-available"
          ? { ...part, output: CULLED_RESULT_NOTICE }
          : part,
      ),
    };
  });
}
