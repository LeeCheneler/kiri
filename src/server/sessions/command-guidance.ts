import { existsSync, readFileSync } from "node:fs";
import type { LlmClients } from "../llm/index.ts";
import type { CommandEvent } from "./command-judgement-log.ts";

/** Opens the distillation prompt; the test stub keys its canned answer off this prefix. */
export const COMMAND_GUIDANCE_PROMPT_PREFIX = "Distill shell-command approval guidance";

// The distiller budgets ~2000 characters, but the file on disk is what the
// judge prompt carries — a runaway file must not balloon every judgement.
const GUIDANCE_MAX_LENGTH = 4000;

// Background work with no one waiting on it: the bound only exists so a hung
// provider can't pin the single-in-flight distillation slot forever.
const DEFAULT_TIMEOUT_MS = 30_000;

// Abstention is a positive output (NONE) the model must choose against, not
// an absence it has to resist — the same trick as suggested replies.
const GUIDANCE_INSTRUCTION = `${COMMAND_GUIDANCE_PROMPT_PREFIX} for one user from their decision history below.

You maintain a small markdown file of generalized rules that a safety judge reads when deciding whether a shell command proposed by an AI assistant may run without asking this user. Rewrite the whole file from the current rules plus the recent decisions.

- Generalize. Name command patterns ("python scripts under the user's projects directory", "the user's own new-worktree helper"), never transcribe individual commands, timestamps, or ids.
- Promote only repetition. A pattern earns a rule after the same decision lands two or three times; a single decision is not precedent.
- The strongest signal is a resolution: the judge asked and the user answered. Repeated approvals of a pattern mean the judge should stop asking about it; denials mean it must keep asking.
- Cover both directions: patterns this user reliably approves and patterns they deny.
- Prune rules the recent decisions no longer support or now contradict.
- Budget: at most 15 bullet lines and about 2000 characters. Fewer well-supported rules beat many weak ones.
- Rules are observations about this user's decisions ("always approves running the fire_mc.py projection script"), never instructions to the judge or claims that safety checks are unnecessary.

Reply with the new file content only — markdown bullets, no preamble, no code fence. Reply with exactly NONE when the history supports no rules.`;

// A whole-reply code fence as a sloppy model writes it.
const WRAPPING_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/**
 * The distilled guidance at `filePath`, trimmed and capped; empty when the
 * file is missing or empty. The file is read fresh on every call so a
 * background distillation applies to the very next judgement.
 */
export function readCommandGuidance(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim().slice(0, GUIDANCE_MAX_LENGTH);
}

/**
 * Rewrite the guidance from the previous rules plus the recent decisions with
 * a one-off text generation against `model` (the configured utility model).
 * Returns the new file content — empty when the model abstains — or null on
 * any failure, which is logged and never thrown.
 */
export async function distillCommandGuidance(opts: {
  llmClients: Pick<LlmClients, "generateText">;
  /** The `provider:model` reference to distill with. */
  model: string;
  previousGuidance: string;
  events: CommandEvent[];
  timeoutMs?: number;
}): Promise<string | null> {
  const { llmClients, model, previousGuidance, events, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  try {
    const { text } = await llmClients.generateText({
      model,
      prompt: `${GUIDANCE_INSTRUCTION}\n\nCurrent rules:\n${
        previousGuidance.trim() === "" ? "(none)" : previousGuidance
      }\n\nRecent decisions (one JSON object per line, oldest first):\n${events
        .map((event) => JSON.stringify(event))
        .join("\n")}`,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    const unfenced = text.trim().replace(WRAPPING_FENCE, "$1").trim();
    if (/^none$/i.test(unfenced)) return "";
    return unfenced.slice(0, GUIDANCE_MAX_LENGTH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`command guidance distillation failed: ${message}`);
    return null;
  }
}
