import type { WorkflowDefinition } from "./schema.ts";

/**
 * In-memory workflow registry. Holds the current set of workflow
 * definitions hydrated from `<cwd>/workflows/`, each optionally paired with
 * the file it was loaded from. Mutated by the loader (and the dev watcher)
 * via `replace`; read by callers via `getWorkflow`, `listWorkflows`, and
 * `getSource`.
 */
export interface Registry {
  getWorkflow(name: string): WorkflowDefinition | undefined;
  listWorkflows(): WorkflowDefinition[];
  /** Absolute path of the file `name` was loaded from, or undefined when unknown. */
  getSource(name: string): string | undefined;
  /**
   * Swap the registry's contents wholesale. The maps are stored by reference
   * to avoid copying on every dev-mode rebuild; the caller must treat them
   * as owned by the registry from this point on and not mutate them.
   * `sources` maps workflow names to the files they were loaded from —
   * omitting it leaves every source unknown.
   */
  replace(
    workflows: ReadonlyMap<string, WorkflowDefinition>,
    sources?: ReadonlyMap<string, string>,
  ): void;
}

/** Create an empty registry. */
export function createRegistry(): Registry {
  let workflows: ReadonlyMap<string, WorkflowDefinition> = new Map();
  let sources: ReadonlyMap<string, string> = new Map();
  return {
    getWorkflow: (name) => workflows.get(name),
    listWorkflows: () => Array.from(workflows.values()),
    getSource: (name) => sources.get(name),
    replace: (next, nextSources) => {
      workflows = next;
      sources = nextSources ?? new Map();
    },
  };
}
