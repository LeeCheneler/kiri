import { arch, release } from "node:os";

/**
 * The machine kiri runs on — and, because kiri is local-first, the machine
 * every workflow step and shell command runs on too.
 */
export interface HostEnvironment {
  /** Node platform identifier — "darwin", "linux", … */
  platform: string;
  /** Kernel release, as `os.release()` reports it. */
  release: string;
  /** CPU architecture — "arm64", "x64", … */
  arch: string;
}

/** Read the running process's host environment. */
export function detectHostEnvironment(): HostEnvironment {
  return { platform: process.platform, release: release(), arch: arch() };
}

/**
 * One-line human description of the host for prompt text, naming the userland
 * family where it matters — e.g. "macOS (Darwin 25.5.0, arm64; BSD userland,
 * not GNU)". Unrecognised platforms fall back to the raw platform identifier.
 */
export function describeHost(host: HostEnvironment): string {
  if (host.platform === "darwin") {
    return `macOS (Darwin ${host.release}, ${host.arch}; BSD userland, not GNU)`;
  }
  if (host.platform === "linux") {
    return `Linux (kernel ${host.release}, ${host.arch}; GNU userland)`;
  }
  return `${host.platform} (${host.release}, ${host.arch})`;
}
