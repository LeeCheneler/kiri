import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type WorkflowDefinition, isUsePublish, isUseStep, workflowSchema } from "./schema.ts";

/**
 * A workflow file that failed to load — either a YAML parse error, a
 * schema-validation failure, a missing `use:` bundle, or a duplicate-name
 * conflict where another file already claimed the same workflow name.
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

/** Absolute path of the bundle's entry script for a `use:` step. */
export const bundleRunPath = (cwd: string, name: string): string =>
  resolve(cwd, "scripts", name, "run.sh");

const validateBundles = (def: WorkflowDefinition, cwd: string): string[] => {
  const missing: string[] = [];
  const steps = def.summarize ? [...def.steps, def.summarize] : def.steps;
  for (const step of steps) {
    if (!isUseStep(step)) continue;
    if (!existsSync(bundleRunPath(cwd, step.use))) missing.push(step.use);
  }
  for (const entry of def.publish ?? []) {
    if (!isUsePublish(entry)) continue;
    if (!existsSync(bundleRunPath(cwd, entry.use))) missing.push(entry.use);
  }
  return missing;
};

/**
 * Scan `dir` for `*.yaml`/`*.yml` files (top-level only — nested files are
 * out of scope by design), parse each as YAML, validate against the
 * workflow schema, and collect the results. `cwd` is the repo root used
 * to resolve `use: <name>` bundles to `<cwd>/scripts/<name>/run.sh`;
 * a workflow referencing a missing bundle is recorded as a per-file
 * failure. Per-file failures (parse errors, validation, duplicates,
 * missing bundles) populate `result.failures` and the scan continues;
 * only directory-level errors (e.g. `dir` doesn't exist) throw.
 */
export async function loadWorkflows(dir: string, cwd: string): Promise<LoadResult> {
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

    const missing = validateBundles(wf, cwd);
    if (missing.length > 0) {
      const list = missing.map((n) => `"${n}"`).join(", ");
      const noun = missing.length === 1 ? "bundle" : "bundles";
      failures.push({
        path: file,
        reason: `missing ${noun} ${list}: expected scripts/<name>/run.sh under ${cwd}`,
      });
      continue;
    }

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
