import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { assertLoopback, startServer } from "./listen.ts";

describe("assertLoopback", () => {
  it("returns silently for 127.0.0.1", () => {
    expect(() => assertLoopback("127.0.0.1")).not.toThrow();
  });

  it("throws a clear error for non-loopback hostnames and includes the offending value", () => {
    for (const value of ["0.0.0.0", "::1", "localhost", "", "192.168.1.1"]) {
      expect(() => assertLoopback(value)).toThrow("kiri must bind to 127.0.0.1");
      expect(() => assertLoopback(value)).toThrow(`got "${value}"`);
      expect(() => assertLoopback(value)).toThrow("Refusing to start");
    }
  });
});

describe("startServer", () => {
  it("binds to 127.0.0.1 on the requested port and serves the app", async () => {
    const app = new Hono();
    app.get("/ping", (c) => c.text("pong"));

    const server = startServer({ app, port: 0 });
    try {
      expect(server.hostname).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);

      const res = await fetch(`http://${server.hostname}:${server.port}/ping`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pong");
    } finally {
      server.stop();
    }
  });
});
