import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type BrandedWorkflowDefinition, isWorkflowDefinition } from "./define-workflow.ts";

/**
 * A workflow file that failed to load — either an import error (syntax,
 * runtime throw, or `defineWorkflow` validation), or a duplicate-name
 * conflict where another file already claimed the same workflow name.
 */
export interface WorkflowLoadFailure {
  /** Absolute path of the file that failed. */
  path: string;
  /** Human-readable reason. For duplicates, includes the conflicting name and the path that already claimed it. */
  reason: string;
}

export interface LoadResult {
  /** Branded workflow definitions keyed by `name`. */
  workflows: Map<string, BrandedWorkflowDefinition>;
  /** Maps each workflow's `name` to the file it was loaded from. */
  sources: Map<string, string>;
  /** Per-file failures. The first occurrence of a duplicate name wins; the loser is recorded here. */
  failures: WorkflowLoadFailure[];
}

// Monotonic cache-bust counter. Two `loadWorkflows` calls in the same
// millisecond would otherwise share a `Date.now()` value and re-use the
// dynamic-import cache; a counter is collision-free at zero cost.
let cacheBustCounter = 0;

/**
 * Scan `dir` for `*.ts` files (top-level only — nested files are out of
 * scope by design), dynamically import each, and collect every
 * `defineWorkflow` export. Per-file failures (import errors, validation,
 * duplicate names) are recorded in `result.failures` and the scan
 * continues; only directory-level errors (e.g. `dir` doesn't exist) throw.
 *
 * Imports are cache-busted via a `?v=` query string. Bun's resolver keys
 * the module cache by URL, so a unique query forces a fresh evaluation;
 * this is Bun-specific and would be a no-op under Node.
 */
export async function loadWorkflows(dir: string): Promise<LoadResult> {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => resolve(dir, name))
    .sort();

  const workflows = new Map<string, BrandedWorkflowDefinition>();
  const sources = new Map<string, string>();
  const failures: WorkflowLoadFailure[] = [];
  const cacheBust = ++cacheBustCounter;

  for (const file of files) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(`${file}?v=${cacheBust}`)) as Record<string, unknown>;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      failures.push({ path: file, reason });
      continue;
    }

    for (const value of Object.values(mod)) {
      if (!isWorkflowDefinition(value)) continue;
      const existing = sources.get(value.name);
      if (existing !== undefined) {
        failures.push({
          path: file,
          reason: `duplicate workflow name "${value.name}" already defined in ${existing}`,
        });
        continue;
      }
      workflows.set(value.name, value);
      sources.set(value.name, file);
    }
  }

  return { workflows, sources, failures };
}
