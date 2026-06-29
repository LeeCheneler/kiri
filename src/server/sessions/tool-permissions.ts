import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * A tool's standing permission in agentic sessions. `"allow"` runs it without
 * prompting, `"off"` withholds it from the model entirely, and `"ask"` (the
 * default — no entry recorded) prompts for approval on every call.
 */
export type ToolPermission = "allow" | "ask" | "off";

// Only the non-default verdicts are persisted, keyed by the namespaced
// `<server>__<tool>` name — the same name the model is offered. An absent key
// reads back as "ask".
const decisionSchema = z.object({ permission: z.enum(["allow", "off"]), decidedAt: z.string() });
const permissionsFileSchema = z.record(z.string(), decisionSchema);
type PermissionsFile = z.infer<typeof permissionsFileSchema>;

/**
 * A file-backed store of standing tool permissions for agentic sessions, keyed
 * by a tool's namespaced `<server>__<tool>` name and persisted across sessions
 * and restarts. The file is read on every lookup, so hand-editing it takes
 * effect on the next turn — no restart.
 */
export interface ToolPermissionStore {
  /** The standing permission for `toolName`; `"ask"` when none is recorded. */
  get(toolName: string): ToolPermission;
  /** Persist `permission` for `toolName`; `"ask"` clears any recorded entry. */
  set(toolName: string, permission: ToolPermission): void;
  /** Every recorded (non-`"ask"`) permission, keyed by namespaced tool name. */
  list(): Record<string, "allow" | "off">;
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
    get: (toolName) => readPermissions(filePath)[toolName]?.permission ?? "ask",
    set: (toolName, permission) => {
      const all = readPermissions(filePath);
      const current = all[toolName]?.permission ?? "ask";
      if (current === permission) return;
      if (permission === "ask") delete all[toolName];
      else all[toolName] = { permission, decidedAt: new Date().toISOString() };
      writePermissions(filePath, all);
    },
    list: () =>
      Object.fromEntries(
        Object.entries(readPermissions(filePath)).map(([name, entry]) => [name, entry.permission]),
      ),
  };
}
