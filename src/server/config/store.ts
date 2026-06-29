import { join } from "node:path";

const WORKFLOWS_DIRNAME = "workflows";
const BUNDLES_DIRNAME = "bundles";
const PERSONAS_DIRNAME = "personas";
const DATA_DIRNAME = ".kiri";
const RUNS_DIRNAME = "runs";
const MCP_CREDENTIALS_FILENAME = "mcp-credentials.json";
const TOOL_PERMISSIONS_FILENAME = "tool-permissions.json";
const INSTRUCTIONS_FILENAME = "kiri.md";
// Canonical first: the loader reads whichever exists, preferring `kiri.yaml`.
const CONFIG_FILENAMES = ["kiri.yaml", "kiri.yml"] as const;
const ENV_FILENAME = ".env";

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
  /** `<cwd>/bundles` — the script bundles, one directory per `use:` step. */
  bundlesDir(): string;
  /** `<cwd>/bundles/<name>` — a single bundle's directory. */
  bundleDir(name: string): string;
  /** `<cwd>/bundles/<name>/run.sh` — a bundle's entry script. */
  bundleRunPath(name: string): string;
  /** `<cwd>/personas` — optional session persona overlays. */
  personasDir(): string;
  /** `<cwd>/.kiri` — gitignored runtime state (state DB, per-run scratch dirs). */
  dataDir(): string;
  /** `<cwd>/.kiri/runs/<runId>` — a run's scratch directory. */
  runDir(runId: string): string;
  /** `<cwd>/.kiri/mcp-credentials.json` — OAuth tokens for MCP servers, kept mode 0600 and separate from the state DB so secrets never touch queryable feed data. */
  mcpCredentialsFile(): string;
  /** `<cwd>/.kiri/tool-permissions.json` — persisted standing tool permissions (allow/off) for agentic sessions; an "off" tool is withheld from the model (plain JSON; tool names aren't secrets). */
  toolPermissionsFile(): string;
  /** `<cwd>/kiri.md` — the workspace's session standing instructions. */
  instructionsFile(): string;
  /** `<cwd>/kiri.yaml` — kiri's structured config file, canonical name (the write target for scaffolding). */
  configFile(): string;
  /** Candidate config-file paths in preference order — `kiri.yaml` then `kiri.yml`. The loader reads whichever exists. */
  configFiles(): string[];
  /** `<cwd>/.env` — the workspace's environment variables, loaded at startup. */
  envFile(): string;
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
    mcpCredentialsFile: () => join(dataDir, MCP_CREDENTIALS_FILENAME),
    toolPermissionsFile: () => join(dataDir, TOOL_PERMISSIONS_FILENAME),
    instructionsFile: () => join(cwd, INSTRUCTIONS_FILENAME),
    configFile: () => join(cwd, CONFIG_FILENAMES[0]),
    configFiles: () => CONFIG_FILENAMES.map((name) => join(cwd, name)),
    envFile: () => join(cwd, ENV_FILENAME),
  };
}
