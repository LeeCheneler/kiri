import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { ConfigStore } from "./store.ts";

/**
 * Load the workspace's `.env` into `target` (default `process.env`), read from
 * the resolved config dir rather than the launch cwd — so a workspace pinned
 * via `KIRI_CONFIG_DIR` gets its own `.env` regardless of where kiri was
 * launched from. Existing variables win: a key already set in `target` (an
 * ambient export, or one the runtime auto-loaded) is left untouched, matching
 * dotenv convention. An absent `.env` is a no-op. Returns the names of the
 * variables it applied, for boot logging — never their values.
 */
export function loadWorkspaceEnv(
  config: ConfigStore,
  target: Record<string, string | undefined> = process.env,
): string[] {
  const path = config.envFile();
  if (!existsSync(path)) return [];

  const parsed = parseEnv(readFileSync(path, "utf8"));
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    applied.push(key);
  }
  return applied;
}
