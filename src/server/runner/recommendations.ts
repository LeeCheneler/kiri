import { appendFileSync, existsSync, readFileSync } from "node:fs";
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

const RECOMMEND_USAGE =
  "usage: kiri-recommend --workflow <name> --title <title> [--description <text>] [--input <key>=<value> ...]";

// Same grammar the workflow schema enforces on declared input names, so a
// typo'd key fails here — at the emitting line — rather than pre-filling
// nothing at action time.
const INPUT_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** Outcome of the `kiri-recommend` command: a process exit code, plus the stderr line when non-zero. */
export interface RecommendCommandResult {
  exitCode: number;
  error?: string;
}

/**
 * Implementation of the hidden `__recommend` CLI command behind the
 * `kiri-recommend` run shim. Parses `--workflow` / `--title` /
 * `--description` / repeatable `--input key=value` flags and appends one
 * recommendation JSON line to the file named by
 * `KIRI_RECOMMENDATIONS_FILE` in `env`. Any problem — missing channel,
 * missing or empty required flag, an input key outside the input-name
 * grammar, an unknown flag — returns a non-zero `exitCode` with `error`
 * set and writes nothing, so a step running under `set -e` fails at the
 * offending call site instead of the line being skipped at ingest.
 */
export function runRecommendCommand(
  args: string[],
  env: Record<string, string | undefined>,
): RecommendCommandResult {
  const fail = (error: string): RecommendCommandResult => ({ exitCode: 1, error });

  const file = env.KIRI_RECOMMENDATIONS_FILE;
  if (!file) {
    return fail(
      "kiri-recommend: KIRI_RECOMMENDATIONS_FILE is not set — kiri-recommend only works inside a main workflow step",
    );
  }

  let workflow: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  const inputs: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      flag !== "--workflow" &&
      flag !== "--title" &&
      flag !== "--description" &&
      flag !== "--input"
    ) {
      return fail(`kiri-recommend: unknown argument "${flag}"\n${RECOMMEND_USAGE}`);
    }
    if (value === undefined) {
      return fail(`kiri-recommend: ${flag} requires a value\n${RECOMMEND_USAGE}`);
    }
    i++;
    if (flag === "--workflow") {
      workflow = value;
    } else if (flag === "--title") {
      title = value;
    } else if (flag === "--description") {
      description = value;
    } else {
      const eq = value.indexOf("=");
      if (eq < 1) {
        return fail(`kiri-recommend: --input expects <key>=<value>, got "${value}"`);
      }
      const key = value.slice(0, eq);
      if (!INPUT_KEY_PATTERN.test(key)) {
        return fail(
          `kiri-recommend: invalid input key "${key}" — keys must match ^[a-z_][a-z0-9_]*$`,
        );
      }
      inputs[key] = value.slice(eq + 1);
    }
  }

  if (!workflow) return fail(`kiri-recommend: --workflow is required\n${RECOMMEND_USAGE}`);
  if (!title) return fail(`kiri-recommend: --title is required\n${RECOMMEND_USAGE}`);
  if (description === "")
    return fail("kiri-recommend: --description cannot be empty — omit the flag instead");

  const line: RecommendationLine = {
    title,
    workflow,
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
  };
  appendFileSync(file, `${JSON.stringify(line)}\n`);
  return { exitCode: 0 };
}

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
