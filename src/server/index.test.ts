import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HTTPException } from "hono/http-exception";
import { createEventBus } from "./events/index.ts";
import { createApp } from "./index.ts";
import {
  type TestEnv,
  createRunWaiter,
  createTestEnv,
  writeBundle,
} from "./routes/test-helpers.ts";
import type { WorkflowDefinition } from "./workflows/index.ts";

describe("createApp", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    env.dispose();
  });

  describe("CORS allow-list", () => {
    const ALLOWED = ["https://local.kiri.build", "http://127.0.0.1:4242", "http://localhost:4242"];

    it("echoes the origin on /api responses for every allowed origin", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      for (const origin of ALLOWED) {
        const res = await app.request("/api/health", { headers: { Origin: origin } });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      }
    });

    it("echoes the origin on stable-path static assets", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/app.js", {
        headers: { Origin: "https://local.kiri.build" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
    });

    it("omits CORS headers for disallowed origins", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/health", {
        headers: { Origin: "https://evil.example" },
      });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("answers OPTIONS preflight on /api/workflows/:name/runs with 204 and the allow-* headers", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows/anything/runs", {
        method: "OPTIONS",
        headers: {
          Origin: "https://local.kiri.build",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, X-Kiri-Client",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Kiri-Client");
    });

    it("answers OPTIONS preflight on DELETE /api/runs/:id with 204 and permits the DELETE method", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs/anything", {
        method: "OPTIONS",
        headers: {
          Origin: "https://local.kiri.build",
          "Access-Control-Request-Method": "DELETE",
          "Access-Control-Request-Headers": "X-Kiri-Client",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://local.kiri.build");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Kiri-Client");
    });
  });

  describe("X-Kiri-Client gate", () => {
    it("rejects state-changing requests without the header with 403", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/workflows/anything/runs", { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "X-Kiri-Client header required" });
    });

    it("accepts state-changing requests when the header is present (any value)", async () => {
      writeBundle(env.cwd, "k", "#!/bin/sh\necho k\n");
      const wf: WorkflowDefinition = { name: "kept", steps: [{ use: "k" }] };
      env.registry.replace(new Map([[wf.name, wf]]));

      const { bus, waitForFinished } = createRunWaiter();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request("/api/workflows/kept/runs", {
        method: "POST",
        headers: { "X-Kiri-Client": "anything" },
      });
      expect(res.status).toBe(202);
      // Drain the background run so afterEach doesn't close the DB while it's
      // still writing — closed-handle errors would log even though the test
      // itself passed.
      const { runId } = (await res.json()) as { runId: string };
      await waitForFinished(runId);
    });

    it("does not require the header on safe (GET) requests", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/runs");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/events", () => {
    it("is mounted when a bus is supplied", async () => {
      const bus = createEventBus();
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd, bus });
      const res = await app.request("/api/events");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      await res.body?.cancel();
    });

    it("is not mounted when no bus is supplied", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/events");
      expect(res.status).toBe(404);
    });
  });

  describe("global error handling", () => {
    it("returns JSON 404 honouring the { error } contract for unmatched /api/* routes", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      const res = await app.request("/api/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "not found" });
    });

    it("translates HTTPException thrown from a handler into its status and message", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      app.get("/api/teapot", () => {
        throw new HTTPException(418, { message: "i am a teapot" });
      });
      const res = await app.request("/api/teapot");
      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ error: "i am a teapot" });
    });

    it("returns an opaque JSON 500 for uncaught throws and logs the cause", async () => {
      const app = createApp({ db: env.db, registry: env.registry, cwd: env.cwd });
      app.get("/api/boom", () => {
        throw new Error("secret internal detail");
      });

      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };

      let res: Response;
      try {
        res = await app.request("/api/boom");
      } finally {
        console.error = originalError;
      }

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body).toEqual({ error: "internal server error" });
      expect(body.error).not.toContain("secret internal detail");
      expect(
        errors.some((args) =>
          (args as unknown[]).some(
            (a) => a instanceof Error && a.message === "secret internal detail",
          ),
        ),
      ).toBe(true);
    });
  });
});
