import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve kiri's working directory: the workspace it scaffolds and reads
 * `workflows/`, `.kiri/`, and state from. `KIRI_CONFIG_DIR` pins a fixed
 * workspace regardless of the shell's cwd; a leading `~`/`~/` is expanded
 * (a quoted or exported value isn't tilde-expanded by the shell), and the
 * result is resolved to an absolute path. Unset falls back to `cwd`.
 */
export function resolveConfigDir(env: Record<string, string | undefined>, cwd: string): string {
  const configured = env.KIRI_CONFIG_DIR;
  if (!configured) return cwd;

  const expanded =
    configured === "~"
      ? homedir()
      : configured.startsWith("~/")
        ? join(homedir(), configured.slice(2))
        : configured;

  return resolve(expanded);
}
