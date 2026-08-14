import type { LlmClients } from "../llm/index.ts";

/** The most replies a generation returns; extra candidate lines are dropped. */
export const MAX_SUGGESTED_REPLIES = 3;

/** A reply is a tap-sized phrase, not a sentence; longer candidate lines are dropped. */
export const SUGGESTED_REPLY_MAX_LENGTH = 60;

/** Opens the generation prompt; the test stub keys its canned answer off this prefix. */
export const SUGGESTED_REPLIES_PROMPT_PREFIX = "Suggest tap-to-send replies";

// The closing question a reply answers sits at the end of the assistant
// message, so the prompt carries the message's tail — a cap keeps a long
// article-sized reply from ballooning the call.
const ASSISTANT_TEXT_MAX_LENGTH = 2000;

// Much tighter than the shell judge's budget: a timed-out judgement there
// degrades to asking the user, so waiting is worth it, while a timed-out
// suggestion degrades to no chips — and a chip that arrives after the user
// has read the reply and started typing is dead weight anyway.
const DEFAULT_TIMEOUT_MS = 8_000;

// Classification before emission: a small model asked for suggestions loves to
// produce them, so the abstaining path is a positive output (an ENDING line)
// it must choose against, not an absence it has to resist.
const REPLIES_INSTRUCTION = `${SUGGESTED_REPLIES_PROMPT_PREFIX} for the assistant message below: the short answers a user might send back with one tap.

Classify how the message ends before suggesting anything. Reply with an ENDING line first:
ENDING: confirmation — it ends by asking the user to confirm or decline a proposed action
ENDING: choice — it ends by asking the user to pick between a few named options
ENDING: none — anything else: it is informational, open-ended, or its answer needs the user's own words

Most messages are ENDING: none — a message takes suggested replies only when a few words settle it. When unsure, answer ENDING: none.

After ENDING: none, write nothing more. Otherwise write the replies, one per line, at most ${MAX_SUGGESTED_REPLIES}, and nothing else. Each reply:
- is in the user's voice — what the user says back, never the assistant's words
- is a short phrase, at most a few words, with no explanation
- settles the closing question on its own (like "Yes, proceed", "No, hold off", or a named option)`;

const ENDING_LINE = /^\s*ending:\s*(\S+)/i;

// A reply line as a sloppy model writes it: maybe a list marker, maybe quoted.
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;
const SURROUNDING_QUOTES = /^["'“”‘’]+|["'“”‘’]+$/g;

// Keep only lines that read as tap-sized replies: strip list markers and
// quotes, then drop blanks, sentinel echoes, header-ish lines ending in a
// colon, and anything too long to be a chip; dedupe case-insensitively and cap
// the count. Defensive throughout — the utility model may be small and sloppy.
function parseReplies(lines: string[]): string[] {
  const replies: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(LIST_MARKER, "").replace(SURROUNDING_QUOTES, "").trim();
    if (line === "" || /^none$/i.test(line) || ENDING_LINE.test(line)) continue;
    if (line.endsWith(":") || line.length > SUGGESTED_REPLY_MAX_LENGTH) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    replies.push(line);
    if (replies.length === MAX_SUGGESTED_REPLIES) break;
  }
  return replies;
}

/**
 * Generate up to three tap-to-send replies to a settled assistant message with
 * a one-off text generation against `model` (the configured utility model).
 * Zero replies is the common, first-class outcome: the model abstains for an
 * open-ended or informational message, and every failure — provider error,
 * timeout, an unreadable reply — is logged and resolves to no replies, never
 * an error a caller has to handle.
 */
export async function generateSuggestedReplies(opts: {
  llmClients: Pick<LlmClients, "generateText">;
  /** The `provider:model` reference to generate with. */
  model: string;
  /** The text of the assistant message the replies answer. */
  assistantText: string;
  timeoutMs?: number;
}): Promise<string[]> {
  const { llmClients, model, assistantText, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const tail = assistantText.slice(-ASSISTANT_TEXT_MAX_LENGTH).trim();
  if (tail === "") return [];
  try {
    const { text } = await llmClients.generateText({
      model,
      prompt: `${REPLIES_INSTRUCTION}\n\nAssistant message:\n${tail}`,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    const lines = text.split("\n");
    // No ENDING line, or an abstaining one, means no replies — a model that
    // skipped the classification is answering some other question.
    const endingAt = lines.findIndex((line) => ENDING_LINE.test(line));
    if (endingAt === -1) return [];
    const ending = (ENDING_LINE.exec(lines[endingAt] as string)?.[1] as string).toLowerCase();
    if (ending !== "confirmation" && ending !== "choice") return [];
    return parseReplies(lines.slice(endingAt + 1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`suggested replies generation failed: ${message}`);
    return [];
  }
}
