import type { Hono } from "hono";

const LOOPBACK_HOSTNAME = "127.0.0.1";

/**
 * Throw if `hostname` is not exactly "127.0.0.1". Defends against env
 * override, config drift, or refactors that would expose kiri's HTTP
 * listener beyond the loopback interface.
 */
export function assertLoopback(hostname: string): void {
  if (hostname !== LOOPBACK_HOSTNAME) {
    throw new Error(
      `kiri must bind to ${LOOPBACK_HOSTNAME} (loopback) only; got "${hostname}". Refusing to start.`,
    );
  }
}

/**
 * Start kiri's HTTP server bound to 127.0.0.1 on `port`. Asserts the
 * loopback bind before opening the socket so a misconfiguration fails
 * fast with a clear error rather than a silent wide-open listener.
 */
export function startServer({
  app,
  port,
}: {
  app: Hono;
  port: number;
}): ReturnType<typeof Bun.serve> {
  const hostname = LOOPBACK_HOSTNAME;
  assertLoopback(hostname);
  return Bun.serve({ hostname, port, fetch: app.fetch });
}
