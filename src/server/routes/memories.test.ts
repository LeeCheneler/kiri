import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { memories } from "../db/schema.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

describe("memories routes", () => {
  let env: TestEnv;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    env = createTestEnv();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    env.dispose();
  });

  const buildApp = (): ReturnType<typeof createApp> =>
    createApp({ db: env.db, registry: env.registry, config: env.config, env: {}, bus });

  const seed = (name: string, description = "A fact.", contentMd = "# Fact\n\nBody.") => {
    const now = new Date();
    env.db
      .insert(memories)
      .values({
        id: crypto.randomUUID(),
        name,
        description,
        contentMd,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  };

  describe("GET /api/memories", () => {
    it("returns an empty list on a fresh workspace", async () => {
      const res = await buildApp().request("/api/memories");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ memories: [] });
    });

    it("lists index entries alphabetically", async () => {
      seed("zulu", "Last.");
      seed("alpha", "First.");
      const res = await buildApp().request("/api/memories");
      const body = (await res.json()) as { memories: { name: string; description: string }[] };
      expect(body.memories.map((m) => m.name)).toEqual(["alpha", "zulu"]);
      expect(body.memories[0]?.description).toBe("First.");
    });
  });

  describe("GET /api/memories/:name", () => {
    it("returns the full memory", async () => {
      seed("prefers-bun", "Prefers bun.", "# Bun\n\nAlways bun.");
      const res = await buildApp().request("/api/memories/prefers-bun");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { memory: { name: string; contentMd: string } };
      expect(body.memory.name).toBe("prefers-bun");
      expect(body.memory.contentMd).toBe("# Bun\n\nAlways bun.");
    });

    it("404s an unknown name", async () => {
      const res = await buildApp().request("/api/memories/missing");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'memory "missing" not found' });
    });

    it("400s a name outside the slug pattern", async () => {
      const res = await buildApp().request("/api/memories/Not%20A%20Slug");
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/memories/:name", () => {
    const patch = (name: string, body: unknown) =>
      buildApp().request(`/api/memories/${name}`, {
        method: "PATCH",
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("updates the description and body, bumps updatedAt, and publishes memory.saved", async () => {
      seed("prefers-bun", "Old.", "Old body.");
      const before = new Date();

      const res = await patch("prefers-bun", { description: "New.", contentMd: "New body.\n" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        memory: { description: string; contentMd: string; updatedAt: string };
      };
      expect(body.memory.description).toBe("New.");
      expect(body.memory.contentMd).toBe("New body.");
      expect(new Date(body.memory.updatedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(events).toContainEqual({ type: "memory.saved", name: "prefers-bun" });
    });

    it("updates a single field, leaving the other untouched", async () => {
      seed("prefers-bun", "Keep me.", "Old body.");

      const res = await patch("prefers-bun", { contentMd: "New body." });

      const body = (await res.json()) as { memory: { description: string; contentMd: string } };
      expect(body.memory.description).toBe("Keep me.");
      expect(body.memory.contentMd).toBe("New body.");
    });

    it("treats an empty patch as a read: no write, no event", async () => {
      seed("prefers-bun");

      const res = await patch("prefers-bun", {});

      expect(res.status).toBe(200);
      expect(events).toEqual([]);
    });

    it("404s an unknown name", async () => {
      const res = await patch("missing", { description: "New." });
      expect(res.status).toBe(404);
    });

    it("rejects unknown fields", async () => {
      seed("prefers-bun");
      const res = await patch("prefers-bun", { name: "renamed" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/memories/:name", () => {
    it("deletes the memory and publishes memory.deleted", async () => {
      seed("stale-fact");

      const res = await buildApp().request("/api/memories/stale-fact", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });

      expect(res.status).toBe(204);
      expect(events).toContainEqual({ type: "memory.deleted", name: "stale-fact" });
      const list = await (await buildApp().request("/api/memories")).json();
      expect(list).toEqual({ memories: [] });
    });

    it("404s an unknown name", async () => {
      const res = await buildApp().request("/api/memories/missing", {
        method: "DELETE",
        headers: CLIENT_HEADERS,
      });
      expect(res.status).toBe(404);
    });
  });
});
