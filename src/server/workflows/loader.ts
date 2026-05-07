import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type BrandedWorkflowDefinition, isWorkflowDefinition } from "./define-workflow.ts";

/** Thrown when two workflow files export definitions with the same `name`. */
export class DuplicateWorkflowError extends Error {
  readonly workflowName: string;
  readonly paths: readonly [string, string];

  constructor(workflowName: string, paths: [string, string]) {
    super(`Duplicate workflow name "${workflowName}" defined in ${paths[0]} and ${paths[1]}`);
    this.name = "DuplicateWorkflowError";
    this.workflowName = workflowName;
    this.paths = paths;
  }
}

/** Thrown when a workflow file fails to import or its definition fails validation. */
export class WorkflowLoadError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to load workflow from ${path}: ${reason}`);
    this.name = "WorkflowLoadError";
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Scan `dir` for `*.ts` files, dynamically import each, and collect every
 * `defineWorkflow` export into a name-keyed map. Throws `WorkflowLoadError`
 * if a file fails to import/validate (path included), or
 * `DuplicateWorkflowError` if two files export workflows with the same
 * name. Files that export no workflows are skipped silently.
 *
 * Imports are cache-busted via a query string so repeated calls (e.g.
 * after a file change in dev) see the latest source.
 */
export async function loadWorkflows(dir: string): Promise<Map<string, BrandedWorkflowDefinition>> {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => resolve(dir, name))
    .sort();

  const result = new Map<string, BrandedWorkflowDefinition>();
  const sourcePaths = new Map<string, string>();
  const cacheBust = Date.now();

  for (const file of files) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(`${file}?v=${cacheBust}`)) as Record<string, unknown>;
    } catch (cause) {
      throw new WorkflowLoadError(file, cause);
    }

    for (const value of Object.values(mod)) {
      if (!isWorkflowDefinition(value)) continue;
      const existing = sourcePaths.get(value.name);
      if (existing !== undefined) {
        throw new DuplicateWorkflowError(value.name, [existing, file]);
      }
      result.set(value.name, value);
      sourcePaths.set(value.name, file);
    }
  }

  return result;
}
