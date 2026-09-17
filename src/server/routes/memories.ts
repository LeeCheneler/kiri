import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type * as errorsApi from "../../shared/api/errors.ts";
import type * as memoriesApi from "../../shared/api/memories.ts";
import type { KiriDb } from "../db/index.ts";
import { memories } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { getScopedMemory, listMemories, memoryNameSchema } from "../sessions/index.ts";
import { onZodFail } from "./shared.ts";

const memoryNameParamSchema = z.object({ name: memoryNameSchema });

const patchMemoryBodySchema = z
  .object({
    description: z.string().min(1).optional(),
    contentMd: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<memoriesApi.PatchMemoryRequest>;

export interface MemoriesRoutesDeps {
  db: KiriDb;
  bus?: EventBus;
}

/**
 * HTTP surface for the memories curation page: list the index, read one
 * memory's body, edit its description or body, and delete it. Creation has
 * no endpoint — memories are saved by sessions through `save_memory`.
 * Every mutation publishes the matching bus event so open views refresh.
 */
export function memoriesRoutes(deps: MemoriesRoutesDeps): Hono {
  const { db, bus } = deps;
  const app = new Hono();

  // Workspace-global memories only: a project's memories are curated on the
  // project's own surface, and a name can exist in both scopes.
  const byName = (name: string) => getScopedMemory(db, null, name);

  app.get("/", (c) =>
    c.json({
      memories: listMemories(db).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    } satisfies memoriesApi.MemoriesResult),
  );

  app.get(
    "/:name",
    zValidator("param", memoryNameParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { name } = c.req.valid("param");
      const memory = byName(name);
      if (!memory)
        return c.json(
          { error: `memory "${name}" not found` } satisfies errorsApi.ApiErrorBody,
          404,
        );
      return c.json({
        memory: {
          name: memory.name,
          description: memory.description,
          contentMd: memory.contentMd,
          createdAt: memory.createdAt.toISOString(),
          updatedAt: memory.updatedAt.toISOString(),
        },
      } satisfies memoriesApi.MemoryResult);
    },
  );

  app.patch(
    "/:name",
    zValidator("param", memoryNameParamSchema, onZodFail("invalid memory name")),
    zValidator("json", patchMemoryBodySchema, onZodFail("invalid memory")),
    (c) => {
      const { name } = c.req.valid("param");
      const { description, contentMd } = c.req.valid("json");
      const memory = byName(name);
      if (!memory)
        return c.json(
          { error: `memory "${name}" not found` } satisfies errorsApi.ApiErrorBody,
          404,
        );
      if (description !== undefined || contentMd !== undefined) {
        db.update(memories)
          .set({
            ...(description !== undefined ? { description } : {}),
            ...(contentMd !== undefined ? { contentMd: contentMd.trimEnd() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(memories.id, memory.id))
          .run();
        bus?.publish({ type: "memory.saved", name });
      }
      const updated = byName(name) as typeof memory;
      return c.json({
        memory: {
          name: updated.name,
          description: updated.description,
          contentMd: updated.contentMd,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      } satisfies memoriesApi.MemoryResult);
    },
  );

  app.delete(
    "/:name",
    zValidator("param", memoryNameParamSchema, onZodFail("invalid memory name")),
    (c) => {
      const { name } = c.req.valid("param");
      const memory = byName(name);
      if (!memory)
        return c.json(
          { error: `memory "${name}" not found` } satisfies errorsApi.ApiErrorBody,
          404,
        );
      db.delete(memories).where(eq(memories.id, memory.id)).run();
      bus?.publish({ type: "memory.deleted", name });
      return c.body(null, 204);
    },
  );

  return app;
}
