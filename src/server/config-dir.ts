import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve kiri's working directory: the workspace it scaffolds and reads
 * `workflows/`, `.kiri/`, and state from. `KIRI_CONFIG_DIR` pins a fixed
 * workspace regardless of the shell's cwd; a leading `~`/`~/` is expanded
 * (a quoted or exported value isn't tilde-expanded by the shell), and the
 * result is resolved to an absolute path. Unset falls back to `cwd`.
 */
/** The port kiri serves on when `KIRI_PORT` is unset — the one the hosted shell targets. */
export const DEFAULT_PORT = 4242;

/**
 * Resolve the port kiri serves on. `KIRI_PORT` overrides the default — for a
 * second instance alongside a running kiri, or a port the default clashes
 * with. Rejects anything that isn't a whole number in the valid port range,
 * so a typo fails loudly at boot instead of binding somewhere surprising.
 */
export function resolvePort(env: Record<string, string | undefined>): number {
  const configured = env.KIRI_PORT;
  if (!configured) return DEFAULT_PORT;

  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid KIRI_PORT "${configured}" — expected an integer between 1 and 65535`);
  }
  return port;
}

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
