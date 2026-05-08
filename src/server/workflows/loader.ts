import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type WorkflowDefinition, workflowSchema } from "./schema.ts";

/**
 * A workflow file that failed to load — either a YAML parse error, a
 * schema-validation failure, or a duplicate-name conflict where another
 * file already claimed the same workflow name.
 */
export interface WorkflowLoadFailure {
  /** Absolute path of the file that failed. */
  path: string;
  /** Human-readable reason. For duplicates, includes the conflicting name and the path that already claimed it. */
  reason: string;
}

export interface LoadResult {
  /** Workflow definitions keyed by `name`. */
  workflows: Map<string, WorkflowDefinition>;
  /** Maps each workflow's `name` to the file it was loaded from. */
  sources: Map<string, string>;
  /** Per-file failures. The first occurrence of a duplicate name wins; the loser is recorded here. */
  failures: WorkflowLoadFailure[];
}

const isYamlFile = (name: string): boolean => name.endsWith(".yaml") || name.endsWith(".yml");

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Scan `dir` for `*.yaml`/`*.yml` files (top-level only — nested files are
 * out of scope by design), parse each as YAML, validate against the
 * workflow schema, and collect the results. Per-file failures (parse
 * errors, validation, duplicate names) are recorded in `result.failures`
 * and the scan continues; only directory-level errors (e.g. `dir`
 * doesn't exist) throw.
 */
export async function loadWorkflows(dir: string): Promise<LoadResult> {
  const files = readdirSync(dir)
    .filter(isYamlFile)
    .map((name) => resolve(dir, name))
    .sort();

  const workflows = new Map<string, WorkflowDefinition>();
  const sources = new Map<string, string>();
  const failures: WorkflowLoadFailure[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (cause) {
      failures.push({ path: file, reason: reasonOf(cause) });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(raw);
    } catch (cause) {
      failures.push({ path: file, reason: reasonOf(cause) });
      continue;
    }

    const result = workflowSchema.safeParse(parsed);
    if (!result.success) {
      failures.push({ path: file, reason: result.error.message });
      continue;
    }
    const wf = result.data;

    const existing = sources.get(wf.name);
    if (existing !== undefined) {
      failures.push({
        path: file,
        reason: `duplicate workflow name "${wf.name}" already defined in ${existing}`,
      });
      continue;
    }
    workflows.set(wf.name, wf);
    sources.set(wf.name, file);
  }

  return { workflows, sources, failures };
}
