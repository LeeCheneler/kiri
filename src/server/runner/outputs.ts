import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { createLogger } from "../log.ts";

const log = createLogger("runs");

// Grammar for a named output, matching the step-id grammar so the two
// reference namespaces read alike in workflow YAML.
const OUTPUT_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Outcome of the `kiri-output` command: a process exit code, plus the stderr line when non-zero. */
export interface OutputCommandResult {
  exitCode: number;
  error?: string;
}

/**
 * Implementation of the hidden `__output` CLI command behind the
 * `kiri-output` run shim. Appends one `{ name, value }` JSON line to the
 * file named by `KIRI_OUTPUTS_FILE` in `env`. Returns a non-zero
 * `exitCode` with `error` set — rather than writing anything — on a
 * missing/empty `KIRI_OUTPUTS_FILE`, a name outside the output grammar,
 * or an argument count other than exactly `<name> <value>`, so a step
 * running under `set -e` fails at the offending call site.
 */
export function runOutputCommand(
  args: string[],
  env: Record<string, string | undefined>,
): OutputCommandResult {
  if (args.length !== 2) {
    return { exitCode: 1, error: "usage: kiri-output <name> <value>" };
  }
  const [name, value] = args as [string, string];
  const file = env.KIRI_OUTPUTS_FILE;
  if (!file) {
    return {
      exitCode: 1,
      error:
        "kiri-output: KIRI_OUTPUTS_FILE is not set — kiri-output only works inside a workflow step that declares outputs:",
    };
  }
  if (!OUTPUT_NAME_PATTERN.test(name)) {
    return {
      exitCode: 1,
      error: `kiri-output: invalid output name "${name}" — names must match ^[a-z][a-z0-9_-]*$`,
    };
  }
  appendFileSync(file, `${JSON.stringify({ name, value })}\n`);
  return { exitCode: 0 };
}

// Per-line shape of a step's outputs file. Grammar isn't re-checked here:
// a name outside it can never match a declared name, so it falls out
// through the undeclared-name skip.
const outputLineSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

/** Result of reading a step's outputs file against its declared names. */
export interface StepOutputsResult {
  /** Declared names that were emitted, mapped to their values. Re-emitting a name overwrites: the last value wins. */
  outputs: Record<string, string>;
  /** Declared names the step never emitted, in declaration order. Any entry here fails the step. */
  missing: string[];
}

/**
 * Read a step's outputs file and resolve it against the step's declared
 * output names. Malformed JSON, schema-failing lines, and names outside
 * the declaration are logged and skipped — the file may hold them, but
 * only declared names count. A missing file simply yields no outputs, so
 * every declared name lands in `missing`.
 */
export function ingestStepOutputs(
  runId: string,
  filePath: string,
  declared: readonly string[],
): StepOutputsResult {
  const outputs: Record<string, string> = {};
  const declaredSet = new Set(declared);

  if (existsSync(filePath)) {
    for (const raw of readFileSync(filePath, "utf8").split("\n")) {
      const line = raw.trim();
      if (line.length === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        log.warn(`run ${runId}: skipping malformed output line: ${message}`);
        continue;
      }

      const check = outputLineSchema.safeParse(parsed);
      if (!check.success) {
        log.warn(`run ${runId}: skipping output line failing schema: ${check.error.message}`);
        continue;
      }

      if (!declaredSet.has(check.data.name)) {
        log.warn(
          `run ${runId}: skipping undeclared output "${check.data.name}" — declare it in the step's outputs: to keep it`,
        );
        continue;
      }

      outputs[check.data.name] = check.data.value;
    }
  }

  return {
    outputs,
    missing: declared.filter((name) => !(name in outputs)),
  };
}
