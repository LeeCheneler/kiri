import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createProject } from "../projects/store.ts";
import {
  deleteMemory,
  getScopedMemory,
  listMemories,
  listProjectMemories,
  saveMemory,
  updateMemory,
} from "./store.ts";

describe("memories store", () => {
  let dir: string;
  let db: KiriDb;
  const projectId = "project-1";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-memories-store-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createProject(db, "Kiri", { id: projectId });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const save = (scope: string | null, name: string, description = "A fact.", contentMd = "Body.") =>
    saveMemory(db, scope, { name, description, contentMd });

  describe("saveMemory", () => {
    it("creates a memory, storing the body without trailing whitespace", () => {
      const { memory, previous } = save(null, "prefers-bun", "Prefers bun.", "Use bun.\n\n");

      expect(previous).toBeUndefined();
      expect(memory).toMatchObject({
        projectId: null,
        name: "prefers-bun",
        description: "Prefers bun.",
        contentMd: "Use bun.",
      });
    });

    it("rewrites an existing name in place and hands back the row it replaced", () => {
      const first = save(null, "prefers-bun", "Old summary.", "Old body.").memory;

      const { memory, previous } = save(null, "prefers-bun", "New summary.", "New body.\n");

      expect(previous?.contentMd).toBe("Old body.");
      expect(memory).toMatchObject({
        id: first.id,
        description: "New summary.",
        contentMd: "New body.",
      });
      expect(listMemories(db)).toHaveLength(1);
    });

    it("keeps each scope's names apart", () => {
      save(null, "shared-name", "Global summary.");

      const { previous } = save(projectId, "shared-name", "Project summary.");

      expect(previous).toBeUndefined();
      expect(listMemories(db)[0]?.description).toBe("Global summary.");
      expect(listProjectMemories(db, projectId)[0]?.description).toBe("Project summary.");
    });
  });

  describe("updateMemory", () => {
    it("changes only the fields the patch carries and stamps the update", () => {
      const { memory } = save(null, "prefers-bun", "Old summary.", "Body.");

      const updated = updateMemory(db, memory.id, { description: "New summary." });

      expect(updated).toMatchObject({ description: "New summary.", contentMd: "Body." });
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(memory.updatedAt.getTime());
    });

    it("stores a patched body without trailing whitespace", () => {
      const { memory } = save(null, "prefers-bun");

      expect(updateMemory(db, memory.id, { contentMd: "Edited.\n\n" }).contentMd).toBe("Edited.");
    });

    it("leaves the row untouched for an empty patch", () => {
      const { memory } = save(null, "prefers-bun");

      expect(updateMemory(db, memory.id, {})).toEqual(memory);
    });
  });

  describe("deleteMemory", () => {
    it("removes the one memory", () => {
      const { memory } = save(null, "stale-fact");
      save(null, "kept-fact");

      deleteMemory(db, memory.id);

      expect(listMemories(db).map((m) => m.name)).toEqual(["kept-fact"]);
    });
  });

  describe("listMemories", () => {
    it("lists index entries alphabetically regardless of save order", () => {
      save(null, "zulu", "Last alphabetically.");
      save(null, "alpha", "First alphabetically.");
      save(projectId, "project-only");

      const summaries = listMemories(db);

      expect(summaries.map((s) => s.name)).toEqual(["alpha", "zulu"]);
      expect(summaries[0]?.description).toBe("First alphabetically.");
    });
  });

  describe("getScopedMemory", () => {
    it("addresses one scope only", () => {
      save(null, "prefers-bun");

      expect(getScopedMemory(db, null, "prefers-bun")?.name).toBe("prefers-bun");
      expect(getScopedMemory(db, projectId, "prefers-bun")).toBeUndefined();
    });
  });
});
