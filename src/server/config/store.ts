import { join } from "node:path";

const WORKFLOWS_DIRNAME = "workflows";
const BUNDLES_DIRNAME = "scripts";
const PERSONAS_DIRNAME = "personas";
const DATA_DIRNAME = ".kiri";
const RUNS_DIRNAME = "runs";
const INSTRUCTIONS_FILENAME = "kiri.md";
const PROVIDERS_FILENAME = "llm-providers.yaml";

/**
 * Resolved configuration for a kiri workspace. Owns the workspace root and
 * derives every workspace path from it, so each directory and file name is
 * defined in exactly one place. Built once at boot from the resolved config
 * dir; pure path derivation that touches no disk.
 */
export interface ConfigStore {
  /** The resolved workspace root — where kiri reads workflows, bundles, and runtime state. */
  cwd(): string;
  /** `<cwd>/workflows` — the workflow definition files. */
  workflowsDir(): string;
  /** `<cwd>/scripts` — the script bundles, one directory per `use:` step. */
  bundlesDir(): string;
  /** `<cwd>/scripts/<name>` — a single bundle's directory. */
  bundleDir(name: string): string;
  /** `<cwd>/scripts/<name>/run.sh` — a bundle's entry script. */
  bundleRunPath(name: string): string;
  /** `<cwd>/personas` — optional session persona overlays. */
  personasDir(): string;
  /** `<cwd>/.kiri` — gitignored runtime state (state DB, per-run scratch dirs). */
  dataDir(): string;
  /** `<cwd>/.kiri/runs/<runId>` — a run's scratch directory. */
  runDir(runId: string): string;
  /** `<cwd>/kiri.md` — the workspace's session standing instructions. */
  instructionsFile(): string;
  /** `<cwd>/llm-providers.yaml` — the LLM provider declarations. */
  providersFile(): string;
}

/**
 * Build the {@link ConfigStore} for a workspace rooted at `cwd` (already
 * resolved to an absolute path by `resolveConfigDir`).
 */
export function createConfigStore(cwd: string): ConfigStore {
  const bundlesDir = join(cwd, BUNDLES_DIRNAME);
  const dataDir = join(cwd, DATA_DIRNAME);
  return {
    cwd: () => cwd,
    workflowsDir: () => join(cwd, WORKFLOWS_DIRNAME),
    bundlesDir: () => bundlesDir,
    bundleDir: (name) => join(bundlesDir, name),
    bundleRunPath: (name) => join(bundlesDir, name, "run.sh"),
    personasDir: () => join(cwd, PERSONAS_DIRNAME),
    dataDir: () => dataDir,
    runDir: (runId) => join(dataDir, RUNS_DIRNAME, runId),
    instructionsFile: () => join(cwd, INSTRUCTIONS_FILENAME),
    providersFile: () => join(cwd, PROVIDERS_FILENAME),
  };
}
