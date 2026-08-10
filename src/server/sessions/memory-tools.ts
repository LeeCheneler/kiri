import { type ToolSet, tool } from "ai";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { memories } from "../db/schema.ts";
import type { KiriEvent } from "../events/index.ts";

/** A persisted memory row. */
export type Memory = typeof memories.$inferSelect;

/**
 * Pattern that constrains a memory's `name`. Re-used by the HTTP routes
 * that address memories by name so the regex lives once and the validation
 * surface matches the tools exactly.
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
    .where(projectId === null ? isNull(memories.projectId) : eq(memories.projectId, projectId))
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
    .where(
      and(
        eq(memories.name, name),
        projectId === null ? isNull(memories.projectId) : eq(memories.projectId, projectId),
      ),
    )
    .get();
}

/**
 * First-party tools that let a session save, recall, and delete memories —
 * small durable facts carried across sessions via the system prompt's memory
 * index. `save_memory` upserts by name so the model updates a fact in place
 * rather than accumulating near-duplicates; a session created within a project
 * saves into that project's memories, a projectless one into the workspace's.
 * Recall and deletion reach further: a project session resolves a name against
 * its project first and falls back to the workspace-global memories its index
 * also lists. Every write publishes `memory.saved` / `memory.deleted` —
 * carrying the project id for a project-scoped memory — so open views refresh.
 * Expected failures (unknown name) throw with a message pointing back at the
 * index — the SDK surfaces it to the model as a tool error and the turn
 * continues.
 */
export function memoryTools(
  db: KiriDb,
  projectId: string | null,
  publish: (event: KiriEvent) => void,
): ToolSet {
  const scope = projectId !== null ? "this project" : "the workspace";

  // A project session sees both indexes, so a name resolves against its own
  // project first and falls back to the global memories it also lists.
  const byName = (name: string): Memory | undefined =>
    projectId === null
      ? getScopedMemory(db, null, name)
      : (getScopedMemory(db, projectId, name) ?? getScopedMemory(db, null, name));

  const requireMemory = (name: string): Memory => {
    const row = byName(name);
    if (!row) {
      throw new Error(
        `No memory named "${name}" — the memory index in your instructions lists what exists.`,
      );
    }
    return row;
  };

  const announce = (
    type: "memory.saved" | "memory.deleted",
    name: string,
    scopeId: string | null,
  ): void => publish({ type, name, ...(scopeId !== null ? { projectId: scopeId } : {}) });

  return {
    save_memory: tool({
      description: `Save a memory: a small durable fact worth carrying into future conversations — a preference, standing context, or a correction the user gave. Memories you save are scoped to ${scope}. Saving an existing memory's name updates it in place; prefer updating a related memory over creating a near-duplicate. Keep one fact per memory, and write it so a future conversation can act on it without this one's context.`,
      inputSchema: z.object({
        name: memoryNameSchema.describe(
          'URL-safe identifier: lowercase letters, digits, and hyphens (e.g. "prefers-bun"). Saving an existing name updates that memory.',
        ),
        description: z
          .string()
          .min(1)
          .describe(
            "One-line summary carried in every session's memory index — make it specific enough to judge relevance at a glance.",
          ),
        content_md: z
          .string()
          .min(1)
          .describe(
            "Full memory body in markdown: the fact itself plus any context needed to apply it later.",
          ),
      }),
      execute: async ({ name, description, content_md }) => {
        const now = new Date();
        // Writes stay in the session's own scope: a project session never
        // rewrites a global memory of the same name, it saves alongside it.
        const existing = getScopedMemory(db, projectId, name);
        if (existing) {
          db.update(memories)
            .set({ description, contentMd: content_md.trimEnd(), updatedAt: now })
            .where(eq(memories.id, existing.id))
            .run();
        } else {
          db.insert(memories)
            .values({
              id: crypto.randomUUID(),
              projectId,
              name,
              description,
              contentMd: content_md.trimEnd(),
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        announce("memory.saved", name, projectId);
        return { name, saved: existing ? "updated" : "created" };
      },
    }),

    read_memory: tool({
      description:
        "Load the full body of a saved memory. Call it when a memory listed in your instructions' memory index looks relevant to the task at hand — the index carries only names and one-line summaries.",
      inputSchema: z.object({
        name: memoryNameSchema.describe("Name of the memory to read, as listed in the index."),
      }),
      execute: async ({ name }) => {
        const row = requireMemory(name);
        return {
          name,
          description: row.description,
          content_md: row.contentMd,
          updated_at: row.updatedAt.toISOString(),
        };
      },
    }),

    delete_memory: tool({
      description:
        "Delete a memory permanently. Use it when the user asks, or when a memory is wrong, stale, or superseded by one you are saving.",
      inputSchema: z.object({
        name: memoryNameSchema.describe("Name of the memory to delete."),
      }),
      execute: async ({ name }) => {
        const row = requireMemory(name);
        db.delete(memories).where(eq(memories.id, row.id)).run();
        announce("memory.deleted", row.name, row.projectId);
        return { name, deleted: true };
      },
    }),
  };
}
