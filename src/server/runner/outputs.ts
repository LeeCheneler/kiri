import { appendFileSync } from "node:fs";

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
