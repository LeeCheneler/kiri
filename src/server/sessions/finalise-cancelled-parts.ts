import { type UIMessage, isReasoningUIPart, isToolUIPart } from "ai";
import { CANCELLED_ERROR_TEXT } from "../../shared/cancelled-tool-call.ts";

type Part = UIMessage["parts"][number];

// Tool states a cancel can catch a call in once its input is complete: it is
// executing (or was just allowed and about to). The call has been issued to
// the model's history, so it needs a terminal result to pair with.
const EXECUTING_TOOL_STATES = new Set(["input-available", "approval-responded"]);

/**
 * Shape a cancelled turn's partial assistant message so it can be persisted
 * and — crucially — sent back to the model on the next turn without the
 * provider rejecting the history:
 *
 * - a tool call still streaming its input is dropped (its input may be a
 *   partial, unparseable fragment; the model never finished issuing it);
 * - a call that was executing is rewritten to an `output-error` carrying
 *   {@link CANCELLED_ERROR_TEXT}, so every issued call has a paired result —
 *   providers reject a tool call with no result;
 * - trailing reasoning with nothing after it is dropped: an interrupted
 *   thinking block is unsigned, and a reasoning item with no following item
 *   is rejected by some providers;
 * - finished calls, text and earlier reasoning pass through untouched.
 *
 * Returns `null` when nothing substantive survives (only step markers, or
 * nothing at all) — the turn had not produced anything worth keeping.
 */
export function finaliseCancelledParts(parts: UIMessage["parts"]): UIMessage["parts"] | null {
  const kept: Part[] = [];
  for (const part of parts) {
    if (!isToolUIPart(part)) {
      kept.push(part);
      continue;
    }
    if (part.state === "input-streaming") continue;
    if (EXECUTING_TOOL_STATES.has(part.state)) {
      kept.push({
        ...part,
        state: "output-error",
        errorText: CANCELLED_ERROR_TEXT,
      } as Part);
      continue;
    }
    kept.push(part);
  }
  while (kept.length > 0 && isDroppableTrailer(kept[kept.length - 1] as Part)) kept.pop();
  return kept.some(isSubstantive) ? kept : null;
}

// Trailing parts that carry nothing the next turn can use: an interrupted
// reasoning block, or the step marker that preceded it.
const isDroppableTrailer = (part: Part): boolean =>
  isReasoningUIPart(part) || part.type === "step-start";

const isSubstantive = (part: Part): boolean =>
  part.type !== "step-start" && !(part.type === "text" && part.text.trim() === "");
