import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { memories } from "../db/schema.ts";

/** A persisted memory row. */
export type Memory = typeof memories.$inferSelect;

/**
 * Pattern that constrains a memory's `name`. Every surface that addresses a
 * memory by name validates against it, so the tools and the HTTP routes accept
 * exactly the same names.
 */
export const memoryNameSchema = z.string().regex(/^[a-z0-9-]+$/, {
  message: "memory name must match ^[a-z0-9-]+$",
});

/** One memory's index entry: everything but the body. */
export interface MemorySummary {
  name: string;
  description: string;
  updatedAt: Date;
}

const inScope = (projectId: string | null) =>
  projectId === null ? isNull(memories.projectId) : eq(memories.projectId, projectId);

// One scope's index entries, alphabetically by name. Alphabetical order keeps
// the system prompt's memory index stable across turns — a save reorders
// nothing.
function listScopedMemories(db: KiriDb, projectId: string | null): MemorySummary[] {
  return db
    .select({
      name: memories.name,
      description: memories.description,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .where(inScope(projectId))
    .orderBy(asc(memories.name))
    .all();
}

/**
 * List every workspace-global memory's index entry, alphabetically by name.
 * Project-scoped memories are excluded — they belong to their project's index.
 */
export function listMemories(db: KiriDb): MemorySummary[] {
  return listScopedMemories(db, null);
}

/** List one project's memory index entries, alphabetically by name. */
export function listProjectMemories(db: KiriDb, projectId: string): MemorySummary[] {
  return listScopedMemories(db, projectId);
}

/**
 * The `limit` most recently updated memories of one scope — the given
 * project's, or the workspace's global ones when `projectId` is null —
 * alphabetically by name. A bounded index keeps the facts touched last and
 * still reads in the stable order of the full one.
 */
export function listRecentMemories(
  db: KiriDb,
  projectId: string | null,
  limit: number,
): MemorySummary[] {
  return db
    .select({
      name: memories.name,
      description: memories.description,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .where(inScope(projectId))
    .orderBy(desc(memories.updatedAt), asc(memories.name))
    .limit(limit)
    .all()
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** How many memories one scope holds: the given project's, or the workspace's when `projectId` is null. */
export function countMemories(db: KiriDb, projectId: string | null): number {
  const row = db.select({ count: count() }).from(memories).where(inScope(projectId)).get();
  return (row as { count: number }).count;
}

/**
 * Read one memory by name within a single scope: the given project's when
 * `projectId` is set, the workspace's global memories when it is null. Names
 * are unique per scope, so the pair addresses at most one row.
 */
export function getScopedMemory(
  db: KiriDb,
  projectId: string | null,
  name: string,
): Memory | undefined {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.name, name), inScope(projectId)))
    .get();
}

const getMemory = (db: KiriDb, id: string): Memory =>
  db.select().from(memories).where(eq(memories.id, id)).get() as Memory;

/**
 * Save a memory into one scope, upserting by name: an existing name in that
 * scope is rewritten in place, a new one is created. The body is stored
 * without trailing whitespace. Returns the saved row and, for a rewrite, the
 * row as it stood before.
 */
export function saveMemory(
  db: KiriDb,
  projectId: string | null,
  input: { name: string; description: string; contentMd: string },
): { memory: Memory; previous: Memory | undefined } {
  return db.transaction(() => {
    const previous = getScopedMemory(db, projectId, input.name);

    if (previous) {
      return {
        memory: updateMemory(db, previous.id, {
          description: input.description,
          contentMd: input.contentMd,
        }),
        previous,
      };
    }

    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(memories)
      .values({
        id,
        projectId,
        name: input.name,
        description: input.description,
        contentMd: input.contentMd.trimEnd(),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { memory: getMemory(db, id), previous };
  });
}

/**
 * Rewrite a memory's description and/or body, leaving anything the patch
 * omits untouched, and stamp it as updated. The body is stored without
 * trailing whitespace. An empty patch changes nothing. Returns the row.
 */
export function updateMemory(
  db: KiriDb,
  id: string,
  patch: { description?: string; contentMd?: string },
): Memory {
  if (patch.description !== undefined || patch.contentMd !== undefined) {
    db.update(memories)
      .set({
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.contentMd !== undefined ? { contentMd: patch.contentMd.trimEnd() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id))
      .run();
  }

  return getMemory(db, id);
}

/** Permanently delete a memory. Deleting an absent memory removes nothing. */
export function deleteMemory(db: KiriDb, id: string): void {
  db.delete(memories).where(eq(memories.id, id)).run();
}
