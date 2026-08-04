import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * A tool's standing permission in agentic sessions. `"allow"` runs it without
 * prompting, `"off"` withholds it from the model entirely, `"ask"` prompts for
 * approval on every call, and `"auto"` decides per call whether the invocation
 * is safe to run unprompted — asking otherwise. Only tools with a per-call
 * judgement honour `"auto"`; everywhere else it behaves as `"ask"`. A tool with
 * no recorded entry falls back to a caller-supplied default — `"ask"` for MCP
 * tools, each built-in tool's own declared default.
 */
export type ToolPermission = "allow" | "ask" | "off" | "auto";

// Recorded decisions, keyed by the namespaced `<server>__<tool>` name — the
// same name the model is offered. An explicit "ask" is persistable so a
// default-"allow" tool set back to Ask sticks; an absent key reads back as
// the caller's fallback.
const decisionSchema = z.object({
  permission: z.enum(["allow", "ask", "off", "auto"]),
  decidedAt: z.string(),
});
const permissionsFileSchema = z.record(z.string(), decisionSchema);
type PermissionsFile = z.infer<typeof permissionsFileSchema>;

/**
 * A file-backed store of standing tool permissions for agentic sessions, keyed
 * by a tool's namespaced `<server>__<tool>` name and persisted across sessions
 * and restarts. The file is read on every lookup, so hand-editing it takes
 * effect on the next turn — no restart.
 */
export interface ToolPermissionStore {
  /** The standing permission for `toolName`; `fallback` when none is recorded. */
  get(toolName: string, fallback?: ToolPermission): ToolPermission;
  /** Persist `permission` for `toolName`. */
  set(toolName: string, permission: ToolPermission): void;
  /** Every recorded permission, keyed by namespaced tool name. */
  list(): Record<string, ToolPermission>;
}

/** Read and validate the whole permissions file, treating an absent file as empty. */
function readPermissions(filePath: string): PermissionsFile {
  if (!existsSync(filePath)) return {};
  return permissionsFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

/** Write the permissions file, creating its directory. */
function writePermissions(filePath: string, data: PermissionsFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Create a {@link ToolPermissionStore} backed by the JSON file at `filePath`
 * (`<cwd>/.kiri/tool-permissions.json`). Tool names aren't secrets, so the file
 * is written with default permissions — unlike the mode-0600 credential store.
 */
export function createToolPermissionStore(filePath: string): ToolPermissionStore {
  return {
    get: (toolName, fallback = "ask") =>
      readPermissions(filePath)[toolName]?.permission ?? fallback,
    // Every set is recorded, including "ask": the store doesn't know a tool's
    // default, so only an explicit entry can override a default-"allow"
    // built-in back to asking.
    set: (toolName, permission) => {
      const all = readPermissions(filePath);
      if (all[toolName]?.permission === permission) return;
      all[toolName] = { permission, decidedAt: new Date().toISOString() };
      writePermissions(filePath, all);
    },
    list: () =>
      Object.fromEntries(
        Object.entries(readPermissions(filePath)).map(([name, entry]) => [name, entry.permission]),
      ),
  };
}
