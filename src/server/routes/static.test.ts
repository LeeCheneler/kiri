import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../index.ts";
import { type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("static routes", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("Cache-Control on stable-path SPA assets", () => {
    it("sends no-store on /app.js, /app.css, /, and /index.html", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      for (const path of ["/app.js", "/app.css", "/", "/index.html"]) {
        const res = await app.request(path);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
    });

    it("does not send no-store on hashed /assets/* paths", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/assets/anything-abc123.js");
      expect(res.headers.get("Cache-Control")).toBeNull();
    });

    it("does not send no-store on /api routes", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/health");
      expect(res.headers.get("Cache-Control")).toBeNull();
    });
  });

  describe("SPA shell fallback", () => {
    const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

    const writeShell = () => {
      const root = join(env.cwd, "client");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.html"), SHELL);
      return root;
    };

    it("serves the SPA shell on a client-side route so refresh boots the app", async () => {
      const staticRoot = writeShell();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot,
      });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(SHELL);
    });

    it("does not intercept unknown /api/* paths", async () => {
      const staticRoot = writeShell();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot,
      });

      const res = await app.request("/api/nope");
      expect(res.status).toBe(404);
    });

    it("does not intercept hashed /assets/* paths", async () => {
      const staticRoot = writeShell();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot,
      });

      const res = await app.request("/assets/missing-abc123.js");
      expect(res.status).toBe(404);
    });

    it("falls through when the SPA shell is not built", async () => {
      const staticRoot = join(env.cwd, "missing-dist");
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot,
      });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(404);
    });

    it("does not run for non-GET methods on client-side routes", async () => {
      const staticRoot = writeShell();
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot,
      });

      const res = await app.request("/runs/abc-123", {
        method: "POST",
        headers: { "X-Kiri-Client": "kiri-ui" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("embedded SPA", () => {
    const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
    const JS = 'console.log("hi");';
    const CSS = "body { color: red; }";
    // 8-byte PNG signature — proves binary roundtrips through the handler.
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const enc = (s: string) => new TextEncoder().encode(s);
    const embeddedFiles = () =>
      new Map<string, Uint8Array>([
        ["/index.html", enc(SHELL)],
        ["/app.js", enc(JS)],
        ["/app.css", enc(CSS)],
        ["/assets/icon-abc123.png", PNG],
      ]);

    it("serves embedded /app.js with the right Content-Type and no-store", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/app.js");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(JS);
    });

    it("serves embedded /app.css with the right Content-Type and no-store", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/app.css");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("css");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(CSS);
    });

    it("serves the embedded shell for the root path with no-store", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(SHELL);
    });

    it("serves the embedded shell for client-side routes so refresh boots the app", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(await res.text()).toBe(SHELL);
    });

    it("does not intercept unknown /api/* paths even when embedded is active", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/api/nope");
      expect(res.status).toBe(404);
    });

    it("serves hashed /assets/* with image content-type and an immutable cache", async () => {
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        embeddedFiles: embeddedFiles(),
      });
      const res = await app.request("/assets/icon-abc123.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toContain("immutable");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    });

    it("uses disk over embedded when both are supplied (explicit override wins)", async () => {
      const root = join(env.cwd, "disk-shell");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.html"), "<html>from-disk</html>");
      const app = createApp({
        db: env.db,
        registry: env.registry,
        cwd: env.cwd,
        staticRoot: root,
        embeddedFiles: embeddedFiles(),
      });

      const res = await app.request("/runs/abc-123");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>from-disk</html>");
    });
  });
});
