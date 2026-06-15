import { zValidator } from "@hono/zod-validator";
import type { UIMessage } from "ai";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import { sessions as sessionsTable } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { createSession, getSession, getSessionMessages, runTurn } from "../sessions/index.ts";
import { onZodFail } from "./shared.ts";

export interface SessionsRoutesDeps {
  db: KiriDb;
  /**
   * Required: every session resolves and streams turns against a model, and
   * the picker lists models off this same client — a session surface without
   * it is inert, so `createApp` leaves these routes unmounted when it's absent.
   */
  llmClients: LlmClients;
  bus?: EventBus;
  /**
   * When supplied, an in-flight turn is reachable via
   * `POST /api/sessions/:id/cancel`. Omit to leave the cancel route unmounted.
   */
  cancelRegistry?: CancelRegistry;
}

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 100;

const sessionIdParamSchema = z.object({ id: z.string().min(1) });

const createSessionBodySchema = z.object({ model: z.string().min(1) }).strict();

const sessionListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SESSION_LIMIT).default(DEFAULT_SESSION_LIMIT),
});

// Only the new user message rides the request; the server loads the prior
// turns from the DB. Parts are validated as a non-empty array and otherwise
// passed through opaquely — they are the AI SDK `UIMessage` parts the model
// round-trips, not something this layer interprets.
const turnBodySchema = z.object({
  message: z.object({
    id: z.string().min(1).optional(),
    role: z.literal("user").optional(),
    parts: z.array(z.unknown()).min(1),
  }),
});

/**
 * Build the Hono sub-app for the agentic session surface: model listing,
 * session create/list/get, the streaming turn endpoint, and an optional
 * cancel. Mounted under `/api` by `createApp`, alongside the system routes.
 */
export function sessionsRoutes(deps: SessionsRoutesDeps): Hono {
  const { db, llmClients, bus, cancelRegistry } = deps;
  const app = new Hono();

  app.get("/models", async (c) => c.json(await llmClients.listModels()));

  app.post(
    "/sessions",
    zValidator("json", createSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { model } = c.req.valid("json");
      // Validate the model resolves now, at create time, so a bad id fails the
      // create with the resolver's own message rather than a later turn.
      try {
        llmClients.resolveModel(model);
      } catch (cause) {
        return c.json({ error: cause instanceof Error ? cause.message : "invalid model" }, 400);
      }
      const session = createSession(db, model);
      bus?.publish({ type: "session.started", id: session.id });
      return c.json({ session }, 201);
    },
  );

  app.get(
    "/sessions",
    zValidator("query", sessionListQuerySchema, onZodFail("invalid query")),
    (c) => {
      const { cursor, limit } = c.req.valid("query");

      // Keyset pagination on (started_at DESC, id DESC), mirroring runs: the
      // cursor is the last seen session's id; resolve its started_at and page
      // strictly after that point. Designed as a compound key from the outset
      // so a later runs+sessions feed union stays a query change, not a rewrite.
      let anchor: { startedAt: Date; id: string } | undefined;
      if (cursor !== undefined) {
        const found = db
          .select({ startedAt: sessionsTable.startedAt, id: sessionsTable.id })
          .from(sessionsTable)
          .where(eq(sessionsTable.id, cursor))
          .get();
        if (!found) return c.json({ error: `cursor "${cursor}" not found` }, 400);
        anchor = found;
      }

      const rows = db
        .select()
        .from(sessionsTable)
        .where(
          anchor
            ? or(
                lt(sessionsTable.startedAt, anchor.startedAt),
                and(eq(sessionsTable.startedAt, anchor.startedAt), lt(sessionsTable.id, anchor.id)),
              )
            : undefined,
        )
        .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id))
        .limit(limit)
        .all();

      const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
      return c.json({ sessions: rows, nextCursor });
    },
  );

  app.get(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      return c.json({ session, messages: getSessionMessages(db, id) });
    },
  );

  app.post(
    "/sessions/:id/messages",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", turnBodySchema, onZodFail("invalid message")),
    async (c) => {
      const { id } = c.req.valid("param");
      const { message } = c.req.valid("json");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // A turn requires an idle session — rejects a concurrent turn (already
      // running) and a terminal one (failed/cancelled). Mirrors a run's
      // "in flight; cancel it first" guard.
      if (session.status !== "idle") {
        return c.json({ error: `session "${id}" is not idle` }, 409);
      }

      const userMessage: UIMessage = {
        id: message.id ?? crypto.randomUUID(),
        role: "user",
        parts: message.parts as UIMessage["parts"],
      };
      // Persistence rides the stream's completion (runTurn's `onFinish`), so the
      // route just hands back the streamed response — there's no `done` to await.
      const { response } = await runTurn(
        { db, llmClients, bus, cancelRegistry },
        { session, userMessage },
      );
      return response;
    },
  );

  if (cancelRegistry) {
    app.post(
      "/sessions/:id/cancel",
      zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
      (c) => {
        const { id } = c.req.valid("param");
        const session = getSession(db, id);
        if (!session) return c.json({ error: `session "${id}" not found` }, 404);
        if (session.status !== "running") {
          return c.json({ error: `session "${id}" is not in flight` }, 409);
        }
        // False only if the registry has no entry — the turn released it in the
        // window between our read and this call. Treat as already-terminal.
        if (!cancelRegistry.requestCancel(id)) {
          return c.json({ error: `session "${id}" is not in flight` }, 409);
        }
        return c.json({ sessionId: id }, 202);
      },
    );
  }

  return app;
}
