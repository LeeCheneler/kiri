import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { recommendations } from "../db/schema.ts";

/**
 * Per-line shape of the recommendations file a main step writes. Each
 * line is a standalone JSON object. `inputs` (when present) is a flat
 * `Record<string, string>` matching the target workflow's declared
 * inputs and pre-fills the invoke modal at action time.
 */
export const recommendationLineSchema = z.object({
  title: z.string().min(1),
  workflow: z.string().min(1),
  description: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
});

export type RecommendationLine = z.infer<typeof recommendationLineSchema>;

/**
 * Read a step's recommendations file and insert one `recommendations`
 * row per valid JSON Lines entry, starting at `startingIndex` and
 * returning the next free index for the caller's running counter.
 *
 * Tolerates a missing file (no rows; returns `startingIndex` unchanged).
 * Malformed JSON or schema-failing lines are logged and skipped without
 * aborting the rest of the file — the producing step has already
 * succeeded by the time this runs, so partial ingestion is correct.
 */
export function ingestStepRecommendations(
  db: KiriDb,
  runId: string,
  filePath: string,
  startingIndex: number,
): number {
  if (!existsSync(filePath)) return startingIndex;

  const contents = readFileSync(filePath, "utf8");
  let index = startingIndex;
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn(`run ${runId}: skipping malformed recommendation line: ${message}`);
      continue;
    }

    const check = recommendationLineSchema.safeParse(parsed);
    if (!check.success) {
      console.warn(
        `run ${runId}: skipping recommendation line failing schema: ${check.error.message}`,
      );
      continue;
    }

    db.insert(recommendations)
      .values({
        id: crypto.randomUUID(),
        runId,
        index,
        title: check.data.title,
        description: check.data.description,
        workflow: check.data.workflow,
        inputs: check.data.inputs,
      })
      .run();
    index += 1;
  }

  return index;
}
