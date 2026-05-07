import type { BrandedWorkflowDefinition } from "./define-workflow.ts";

/**
 * In-memory workflow registry. Holds the current set of workflow
 * definitions hydrated from `<cwd>/workflows/`. Mutated by the loader
 * (and the dev watcher) via `replace`; read by callers via `getWorkflow`
 * and `listWorkflows`.
 */
export interface Registry {
  getWorkflow(name: string): BrandedWorkflowDefinition | undefined;
  listWorkflows(): BrandedWorkflowDefinition[];
  replace(workflows: ReadonlyMap<string, BrandedWorkflowDefinition>): void;
}

/** Create an empty registry. */
export function createRegistry(): Registry {
  let workflows: ReadonlyMap<string, BrandedWorkflowDefinition> = new Map();
  return {
    getWorkflow: (name) => workflows.get(name),
    listWorkflows: () => Array.from(workflows.values()),
    replace: (next) => {
      workflows = next;
    },
  };
}
