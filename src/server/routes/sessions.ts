import { zValidator } from "@hono/zod-validator";
import { type ModelMessage, type ToolSet, type UIMessage, isToolUIPart } from "ai";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
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
  INVESTIGATE_TOOL_NAME,
  type Session,
  type ToolApprovalDecision,
  type ToolOutput,
  createSession,
  createSystemPromptBuilder,
  createToolGrantStore,
  deleteMessagesFrom,
  deleteSession,
  findChildByToolCall,
  getSession,
  getSessionMessages,
  getSessionPreviews,
  investigateTool,
  listPersonas,
  resumeTurn,
  resumeTurnWithToolOutput,
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

// A top-level session supplies `model`. A child sub-session supplies `parent`
// (with the spawning `toolCallId`) instead, inheriting the parent's model — so
// `model` is optional and only required when there's no parent. A child is
// marked solely by its parent link; there is no separate kind.
const createSessionBodySchema = z
  .object({
    model: z.string().min(1).optional(),
    parent: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
  })
  .strict();

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

// Only the trailing message rides the request; the server loads the prior turns
// from the DB. Usually a new `user` message; on an approval resume the client
// re-sends the paused `assistant` message carrying the user's verdicts. Parts
// are validated as a non-empty array and otherwise passed through opaquely —
// they are the AI SDK `UIMessage` parts the model round-trips, not something
// this layer interprets.
const turnBodySchema = z.object({
  message: z.object({
    id: z.string().min(1).optional(),
    role: z.enum(["user", "assistant"]).optional(),
    parts: z.array(z.unknown()).min(1),
  }),
});

// Granting an "Always Allow" decision: a single namespaced `<server>__<tool>` name.
const toolGrantBodySchema = z.object({ tool: z.string().min(1) }).strict();

// Whether a message awaits the user's verdict — its last assistant turn called a
// tool that hasn't been allowed or denied yet.
const hasPendingApproval = (parts: UIMessage["parts"]): boolean =>
  parts.some((part) => isToolUIPart(part) && part.state === "approval-requested");

// Whether a message awaits a client-completed tool's result — its last assistant
// turn called a tool with no server `execute` (e.g. `investigate`) that hasn't
// been given an output yet. Such a call rests in `input-available`; only a
// client tool persists there, since server-run tools settle output-available.
const hasPendingToolOutput = (parts: UIMessage["parts"]): boolean =>
  parts.some((part) => isToolUIPart(part) && part.state === "input-available");

// Whether `toolCallId` already raised an approval request earlier in this
// conversation. Distinguishes revalidating a call the user has already answered
// (the AI SDK re-checks `needsApproval` on resume) from gating a fresh one.
const hasPriorApprovalRequest = (messages: ModelMessage[], toolCallId: string): boolean =>
  messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          (part as { type?: string }).type === "tool-approval-request" &&
          (part as { toolCallId?: string }).toolCallId === toolCallId,
      ),
  );

// Pull the user's tool-approval verdicts out of a resumed assistant message.
const extractApprovals = (parts: UIMessage["parts"]): ToolApprovalDecision[] => {
  const decisions: ToolApprovalDecision[] = [];
  for (const part of parts) {
    if (isToolUIPart(part) && part.state === "approval-responded") {
      decisions.push({
        toolCallId: part.toolCallId,
        approved: part.approval.approved,
        reason: part.approval.reason,
      });
    }
  }
  return decisions;
};

// Pull the client-supplied tool outputs out of a resumed assistant message — the
// results the client computed for a paused client-completed call (e.g. the
// investigation report) and now sends back to continue the turn.
const extractToolOutputs = (parts: UIMessage["parts"]): ToolOutput[] => {
  const outputs: ToolOutput[] = [];
  for (const part of parts) {
    if (isToolUIPart(part) && part.state === "output-available") {
      outputs.push({ toolCallId: part.toolCallId, output: part.output });
    }
  }
  return outputs;
};

/**
 * Build the Hono sub-app for the agentic session surface: model listing,
 * session create/list/get, the streaming turn endpoint, and an optional
 * cancel. Mounted under `/api` by `createApp`, alongside the system routes.
 */
export function sessionsRoutes(deps: SessionsRoutesDeps): Hono {
  const { db, config, llmClients, bus, cancelRegistry, mcpRegistry } = deps;
  const app = new Hono();

  // Persisted "Always Allow" tool grants, read on every tool request so a grant
  // (or a hand-edit revoking one) takes effect on the next turn.
  const toolGrants = createToolGrantStore(config.toolGrantsFile());

  // The tools offered to a turn — the live MCP server tools, each gated behind
  // the user's approval unless it carries an "Always Allow" grant, plus the
  // first-party `investigate` tool. Read per turn (not once) so a config reload
  // that adds or drops MCP servers, and a grant made since the last turn, are
  // both reflected on the next turn. Only a top-level session is offered
  // `investigate`; a child sub-session isn't, so a worker can't spawn another.
  const activeTools = (session: Session): ToolSet => {
    const tools = mcpRegistry?.tools() ?? {};
    const gated: ToolSet = {};
    for (const [name, tool] of Object.entries(tools)) {
      gated[name] = {
        ...tool,
        // An ungranted tool always pauses for an Allow / Always allow / Deny
        // decision. A granted tool runs straight away — except a call the user
        // has already answered this turn, which must still report as needing
        // approval so the SDK honours that answer on resume. (The SDK re-checks
        // `needsApproval` when resuming and denies a call that no longer needs
        // it — so a fresh Always-allow grant would otherwise cancel the very
        // call the user just allowed.)
        needsApproval: (
          _input: unknown,
          { toolCallId, messages }: { toolCallId: string; messages: ModelMessage[] },
        ) => !toolGrants.isGranted(name) || hasPriorApprovalRequest(messages, toolCallId),
      };
    }
    if (session.parentSessionId === null) gated[INVESTIGATE_TOOL_NAME] = investigateTool;
    return gated;
  };

  app.get("/models", async (c) => c.json(await llmClients.listModels()));

  // The personas available to attach at session creation — one `{ id, name }`
  // per `personas/<id>.md` in the workspace, the `name` humanised for display.
  // Empty when none are defined.
  app.get("/personas", (c) => c.json({ personas: listPersonas(config) }));

  app.post(
    "/sessions",
    zValidator("json", createSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { model, parent, toolCallId } = c.req.valid("json");

      // A child sub-session inherits its parent's model and is hidden from the
      // feed/lists — reachable inline in its parent's transcript and at its own
      // URL. The spawning `toolCallId` lets the parent re-attach it after reload.
      // A child is marked solely by its parent link — no separate kind flag.
      if (parent !== undefined) {
        const parentSession = getSession(db, parent);
        if (!parentSession) return c.json({ error: `parent session "${parent}" not found` }, 404);
        // Idempotent for a given tool call: re-attaching the same investigation
        // (after a reload) returns the existing child rather than spawning a
        // duplicate. Keyed on the spawning `toolCallId`, so it only applies when
        // one is supplied.
        if (toolCallId !== undefined) {
          const existing = findChildByToolCall(db, parent, toolCallId);
          if (existing) return c.json({ session: existing }, 200);
        }
        const child = createSession(db, parentSession.model, {
          parentSessionId: parent,
          parentToolCallId: toolCallId,
        });
        bus?.publish({ type: "session.started", id: child.id });
        return c.json({ session: child }, 201);
      }

      if (model === undefined) {
        return c.json({ error: "model is required" }, 400);
      }
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

      // Only top-level sessions are listed; child investigations are reachable
      // inline in their parent and at their own URL, never in the feed.
      const topLevel = isNull(sessionsTable.parentSessionId);
      const rows = db
        .select()
        .from(sessionsTable)
        .where(
          anchor
            ? and(
                topLevel,
                or(
                  lt(sessionsTable.startedAt, anchor.startedAt),
                  and(
                    eq(sessionsTable.startedAt, anchor.startedAt),
                    lt(sessionsTable.id, anchor.id),
                  ),
                ),
              )
            : topLevel,
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

      const parts = message.parts as UIMessage["parts"];
      const last = getSessionMessages(db, id).at(-1);
      const lastParts = last?.role === "assistant" ? (last.parts as UIMessage["parts"]) : undefined;
      // Two ways a turn can be paused awaiting the client: a tool call gated for
      // approval, or a client-completed call (e.g. `investigate`) awaiting its
      // output. Either blocks a fresh message until it's resolved.
      const pendingApproval = lastParts !== undefined && hasPendingApproval(lastParts);
      const pendingOutput = lastParts !== undefined && hasPendingToolOutput(lastParts);

      // Resolve the live tools for this turn — the approval-gated MCP tools plus
      // (for a non-investigation session) `investigate` — and compose the system
      // prompt from their names so the core layer's tool guidance matches what
      // the model is actually offered.
      const tools = activeTools(session);
      const buildSystemPrompt = createSystemPromptBuilder(config, Object.keys(tools));
      const turnDeps = { db, llmClients, bus, cancelRegistry, buildSystemPrompt, tools };

      // Persistence rides the stream's completion (the turn's `onFinish`), so the
      // route just hands back the streamed response. The turn is drained
      // server-side, so a client that disconnects doesn't cancel it; only an
      // explicit cancel through `POST /api/sessions/:id/cancel` does.

      // An assistant message resumes a paused turn: it carries either the user's
      // approval verdicts or a client-completed tool's output.
      if (message.role === "assistant") {
        if (pendingApproval) {
          const { response } = await resumeTurn(turnDeps, {
            session,
            approvals: extractApprovals(parts),
          });
          return response;
        }
        if (pendingOutput) {
          const { response } = await resumeTurnWithToolOutput(turnDeps, {
            session,
            outputs: extractToolOutputs(parts),
          });
          return response;
        }
        return c.json({ error: `session "${id}" has no pending tool call to resolve` }, 409);
      }

      // A new user message can't start while a tool call is still pending — the
      // model can't continue past an unanswered call.
      if (pendingApproval || pendingOutput) {
        return c.json(
          { error: `session "${id}" has a pending tool call; respond to it first` },
          409,
        );
      }

      const userMessage: UIMessage = { id: message.id ?? crypto.randomUUID(), role: "user", parts };
      const { response } = await runTurn(turnDeps, { session, userMessage });
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

  // Record an "Always Allow" grant for a tool, so it stops prompting. Workspace-
  // scoped, not per-session: a grant persists across every session and restart.
  app.post(
    "/tool-grants",
    zValidator("json", toolGrantBodySchema, onZodFail("invalid grant")),
    (c) => {
      const { tool } = c.req.valid("json");
      toolGrants.grant(tool);
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
