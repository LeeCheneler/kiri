import { zValidator } from "@hono/zod-validator";
import type { ToolSet, UIMessage } from "ai";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { sessions as sessionsTable } from "../db/schema.ts";
import type { EventBus, SessionStatus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import {
  createSession,
  createSystemPromptBuilder,
  deleteMessagesFrom,
  deleteSession,
  getSession,
  getSessionMessages,
  getSessionPreviews,
  listPersonas,
  runTurn,
  updateSessionModel,
  updateSessionPersona,
} from "../sessions/index.ts";
import { onZodFail } from "./shared.ts";

export interface SessionsRoutesDeps {
  db: KiriDb;
  /** Workspace config; the session system prompt reads `kiri.md` (and personas) against it. */
  config: ConfigStore;
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
  /**
   * MCP server registry. Its discovered tools are offered to each turn's model,
   * read live so a config reload is reflected on the next turn. Omitted leaves
   * sessions as a plain chat with no tools.
   */
  mcpRegistry?: McpRegistry;
}

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 100;

const sessionIdParamSchema = z.object({ id: z.string().min(1) });

const messageParamSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

const createSessionBodySchema = z.object({ model: z.string().min(1) }).strict();

// Either field may be set independently: the aside swaps the model and the
// persona through this one endpoint. `persona: null` detaches; omitting a field
// leaves it unchanged.
const patchSessionBodySchema = z
  .object({ model: z.string().min(1).optional(), persona: z.string().min(1).nullable().optional() })
  .strict();

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
  const { db, config, llmClients, bus, cancelRegistry, mcpRegistry } = deps;
  const app = new Hono();

  // The tools offered to a turn — the live MCP server tools. Read per turn (not
  // once) so a config reload that adds or drops MCP servers is reflected on the
  // next turn rather than requiring a restart.
  const activeTools = (): ToolSet => mcpRegistry?.tools() ?? {};

  app.get("/models", async (c) => c.json(await llmClients.listModels()));

  // The personas available to attach at session creation — one `{ id, name }`
  // per `personas/<id>.md` in the workspace, the `name` humanised for display.
  // Empty when none are defined.
  app.get("/personas", (c) => c.json({ personas: listPersonas(config) }));

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
      // Label each row with a preview of its first user message — the
      // human-readable identifier the list leads with.
      const previews = getSessionPreviews(
        db,
        rows.map((row) => row.id),
      );
      const sessions = rows.map((row) => ({ ...row, preview: previews.get(row.id) ?? null }));
      return c.json({ sessions, nextCursor });
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

  app.patch(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", patchSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { id } = c.req.valid("param");
      const { model, persona } = c.req.valid("json");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // Validate the model resolves now, mirroring create, so a bad id fails the
      // patch with the resolver's own message rather than a later turn.
      if (model !== undefined) {
        try {
          llmClients.resolveModel(model);
        } catch (cause) {
          return c.json({ error: cause instanceof Error ? cause.message : "invalid model" }, 400);
        }
        updateSessionModel(db, id, model);
      }
      // A named persona must be one the workspace defines; `null` detaches.
      if (persona !== undefined) {
        if (persona !== null && !listPersonas(config).some((p) => p.id === persona)) {
          return c.json({ error: `unknown persona "${persona}"` }, 400);
        }
        updateSessionPersona(db, id, persona);
      }
      const updated = getSession(db, id) as typeof session;
      // The turn endpoint resolves the model and composes the persona per turn,
      // so either change applies from the next turn. Announce it like any other
      // session change so the feed and the open chat refresh; status is unchanged.
      bus?.publish({ type: "session.updated", id, status: updated.status as SessionStatus });
      return c.json({ session: updated });
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
      // Reject only a concurrent turn (one already in flight). A session is
      // long-lived and resumable: after an idle, failed, or cancelled turn it
      // accepts the next message, picking the conversation back up.
      if (session.status === "running") {
        return c.json({ error: `session "${id}" already has a turn in flight` }, 409);
      }

      const userMessage: UIMessage = {
        id: message.id ?? crypto.randomUUID(),
        role: "user",
        parts: message.parts as UIMessage["parts"],
      };
      // Persistence rides the stream's completion (runTurn's `onFinish`), so the
      // route just hands back the streamed response — there's no `done` to await.
      // The turn is drained server-side, so a client that disconnects (navigates
      // away, reloads, closes the tab) doesn't cancel it; only an explicit cancel
      // through `POST /api/sessions/:id/cancel` does.
      // Resolve the active tools (built-in + live MCP) for this turn, and compose
      // the system prompt from their names so the core layer's tool guidance
      // matches what the model is actually offered.
      const tools = activeTools();
      const buildSystemPrompt = createSystemPromptBuilder(config, Object.keys(tools));
      const { response } = await runTurn(
        { db, llmClients, bus, cancelRegistry, buildSystemPrompt, tools },
        { session, userMessage },
      );
      return response;
    },
  );

  app.delete(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // A running session has a turn streaming and persisting server-side;
      // deleting mid-turn would orphan that write, so require a cancel first.
      if (session.status === "running") {
        return c.json({ error: `session "${id}" has a turn in flight; cancel it first` }, 409);
      }
      deleteSession(db, id);
      bus?.publish({ type: "session.deleted", id });
      return c.body(null, 204);
    },
  );

  app.delete(
    "/sessions/:id/messages/:messageId",
    zValidator("param", messageParamSchema, onZodFail("invalid session or message id")),
    (c) => {
      const { id, messageId } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // A running session has a turn streaming and persisting server-side;
      // truncating mid-turn would race that write, so require a cancel first —
      // matching the delete/cancel guards.
      if (session.status === "running") {
        return c.json({ error: `session "${id}" has a turn in flight; cancel it first` }, 409);
      }
      if (!deleteMessagesFrom(db, id, messageId)) {
        return c.json({ error: `message "${messageId}" not found in session "${id}"` }, 404);
      }
      return c.body(null, 204);
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
