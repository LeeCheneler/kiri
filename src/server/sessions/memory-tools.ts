import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import type { KiriEvent } from "../events/index.ts";
import {
  type Memory,
  deleteMemory,
  getScopedMemory,
  memoryNameSchema,
  saveMemory,
} from "../memories/store.ts";
import { MAX_DIFF_LENGTH, unifiedDiff } from "./write-tool-diffs.ts";

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
        // Writes stay in the session's own scope: a project session never
        // rewrites a global memory of the same name, it saves alongside it.
        const { memory, previous } = saveMemory(db, projectId, {
          name,
          description,
          contentMd: content_md,
        });
        announce("memory.saved", name, projectId);

        // The diff is app-only — a create diffs against nothing, so the body
        // renders as additions; the result's projection keeps it out of what
        // the model is paid for.
        return {
          name,
          saved: previous ? "updated" : "created",
          ...unifiedDiff(previous?.contentMd ?? "", memory.contentMd, MAX_DIFF_LENGTH),
        };
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
        deleteMemory(db, row.id);
        announce("memory.deleted", row.name, row.projectId);
        return { name, deleted: true };
      },
    }),
  };
}
