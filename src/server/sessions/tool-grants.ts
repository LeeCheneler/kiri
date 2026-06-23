import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/** One persisted "Always Allow" grant: when the user permanently approved the tool. */
const toolGrantSchema = z.object({ grantedAt: z.string() });

/**
 * The on-disk grants file: one entry per always-allowed tool, keyed by the
 * tool's namespaced `<server>__<tool>` name — the same name the model is offered.
 */
const grantsFileSchema = z.record(z.string(), toolGrantSchema);
type GrantsFile = z.infer<typeof grantsFileSchema>;

/**
 * A file-backed store of "Always Allow" tool grants for agentic sessions.
 * Grants are keyed by a tool's namespaced `<server>__<tool>` name and persist
 * across sessions and restarts, so a tool the user permanently approved never
 * prompts again. The file is read on every lookup, so hand-editing it (deleting
 * an entry to revoke a grant) takes effect on the next tool request — no restart.
 */
export interface ToolGrantStore {
  /** Whether `toolName` has a persisted "Always Allow" grant. */
  isGranted(toolName: string): boolean;
  /** Persist an "Always Allow" grant for `toolName`; a no-op if already granted. */
  grant(toolName: string): void;
  /** The names of all granted tools. */
  list(): string[];
}

/** Read and validate the whole grants file, treating an absent file as empty. */
function readGrants(filePath: string): GrantsFile {
  if (!existsSync(filePath)) return {};
  return grantsFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

/** Write the grants file, creating its directory. */
function writeGrants(filePath: string, data: GrantsFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Create a {@link ToolGrantStore} backed by the JSON file at `filePath`
 * (`<cwd>/.kiri/tool-grants.json`). Tool names aren't secrets, so the file is
 * written with default permissions — unlike the mode-0600 credential store.
 */
export function createToolGrantStore(filePath: string): ToolGrantStore {
  return {
    isGranted: (toolName) => toolName in readGrants(filePath),
    grant: (toolName) => {
      const all = readGrants(filePath);
      if (toolName in all) return;
      all[toolName] = { grantedAt: new Date().toISOString() };
      writeGrants(filePath, all);
    },
    list: () => Object.keys(readGrants(filePath)),
  };
}
