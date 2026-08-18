import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { createLogger } from "../log.ts";

const log = createLogger("shell");

// One decision by the auto shell permission — the deterministic screen or the
// utility-model judge — on a single run_command call.
const judgementEventSchema = z.object({
  type: z.literal("judgement"),
  toolCallId: z.string(),
  command: z.string(),
  cwd: z.string(),
  verdict: z.enum(["allow", "ask"]),
  reason: z.string(),
  source: z.enum(["screen", "judge"]),
  at: z.string(),
});

// The user's verdict on a paused run_command call, correlated to its
// judgement (when one exists) by toolCallId.
const resolutionEventSchema = z.object({
  type: z.literal("resolution"),
  toolCallId: z.string(),
  command: z.string(),
  approved: z.boolean(),
  at: z.string(),
});

/** Per-line shape of the command judgement log. */
export const commandEventSchema = z.discriminatedUnion("type", [
  judgementEventSchema,
  resolutionEventSchema,
]);

export type CommandEvent = z.infer<typeof commandEventSchema>;
export type CommandJudgementEvent = z.infer<typeof judgementEventSchema>;
export type CommandResolutionEvent = z.infer<typeof resolutionEventSchema>;

/** Append one event to the JSONL log at `filePath`, creating its directory. */
export function appendCommandEvent(filePath: string, event: CommandEvent): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(event)}\n`);
}

// Every valid event in the file, oldest first. Malformed JSON and
// schema-failing lines are warned and skipped: the log is derived state, so
// a corrupt line loses one event, never the feature.
function readValidEvents(filePath: string): CommandEvent[] {
  if (!existsSync(filePath)) return [];
  const events: CommandEvent[] = [];
  for (const raw of readFileSync(filePath, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      log.warn(`command judgement log: skipping malformed line: ${message}`);
      continue;
    }

    const check = commandEventSchema.safeParse(parsed);
    if (!check.success) {
      log.warn(`command judgement log: skipping line failing schema: ${check.error.message}`);
      continue;
    }

    events.push(check.data);
  }
  return events;
}

/** The last `limit` valid events, oldest first; a missing file yields none. */
export function readRecentCommandEvents(filePath: string, limit: number): CommandEvent[] {
  return readValidEvents(filePath).slice(-limit);
}

/** Rewrite the log keeping only the last `keep` valid events; a missing file is a no-op. */
export function trimCommandLog(filePath: string, keep: number): void {
  if (!existsSync(filePath)) return;
  const kept = readValidEvents(filePath).slice(-keep);
  writeFileSync(filePath, kept.map((event) => `${JSON.stringify(event)}\n`).join(""));
}
