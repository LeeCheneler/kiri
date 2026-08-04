import { existsSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { zValidator } from "@hono/zod-validator";
import {
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  UI_MESSAGE_STREAM_HEADERS,
  isToolUIPart,
} from "ai";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import { type ModelsConfig, configuredDelegateRoles } from "../config/schema.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, sessions as sessionsTable } from "../db/schema.ts";
import type { EventBus, SessionStatus } from "../events/index.ts";
import { EFFORT_LEVELS, type LlmClients } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import {
  BUILTIN_TOOLS,
  type RunTurnDeps,
  SESSION_TITLE_MAX_LENGTH,
  type Session,
  type SessionCwd,
  type StreamRegistry,
  type ToolApprovalDecision,
  type ToolPermission,
  type ToolPermissionStore,
  articleTools,
  createSession,
  createStreamRegistry,
  createSystemPromptBuilder,
  delegateTool,
  deleteMessagesFrom,
  deleteSession,
  filesystemTools,
  generateSessionTitle,
  getSession,
  getSessionChildren,
  getSessionMessages,
  getSessionPreviews,
  imageTools,
  judgeCommand,
  listSkills,
  resumeTurn,
  runTurn,
  screenCommand,
  setSessionPinned,
  shellTools,
  skillTools,
  updateSessionCwd,
  updateSessionEffort,
  updateSessionImageModel,
  updateSessionModel,
  updateSessionTitle,
  workflowTools,
} from "../sessions/index.ts";
import type { Registry } from "../workflows/index.ts";
import { articleParamSchema, onZodFail } from "./shared.ts";

export interface SessionsRoutesDeps {
  db: KiriDb;
  /** Workspace config; the session system prompt reads `kiri.md` against it. */
  config: ConfigStore;
  /** Workflow registry backing the first-party workflow tools — read live, so a definition change is reflected on the next turn. */
  registry: Registry;
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
   * Registry of in-flight turn streams a reconnecting client rejoins. Defaults
   * to a fresh registry owned by this surface; injectable for tests and to share
   * one registry across surfaces later.
   */
  streamRegistry?: StreamRegistry;
  /**
   * MCP server registry. Its discovered tools are offered to each turn's model,
   * read live so a config reload is reflected on the next turn. Omitted leaves
   * sessions as a plain chat with no tools.
   */
  mcpRegistry?: McpRegistry;
  /** Standing per-tool permissions: an "off" tool is withheld, an "ask" tool is gated, an "allow" tool runs straight through. */
  toolPermissions: ToolPermissionStore;
  /** Live provider names for the workflow authoring tools' validation gate; forwarded to `workflowTools`. */
  getProviderNames?: () => ReadonlySet<string>;
  /**
   * Live sandbox for the first-party filesystem tools: the absolute
   * directories declared under `filesystem.allowed_directories` in
   * `kiri.yaml`, read per turn so a config edit applies on the next one.
   * Empty (or omitted) withholds the filesystem tools entirely — declaring
   * the sandbox is what enables them.
   */
  getAllowedDirectories?: () => readonly string[];
  /**
   * Live default working directory for new sessions: the absolute directory
   * resolved from `filesystem.default_working_directory` in `kiri.yaml` (or
   * the first allowed directory), read at each session create. Omitted — or
   * pointing at a directory that doesn't exist on disk — leaves new sessions
   * without a working directory.
   */
  getDefaultWorkingDirectory?: () => string | undefined;
  /**
   * Live models config from `kiri.yaml`'s `models:` section, read per use so
   * a config edit applies at once. Shortcuts ride the model listing (so the
   * pickers can pin them); delegates size the workers the delegate tool
   * spawns. Empty (or omitted) means none are configured.
   */
  getModelsConfig?: () => ModelsConfig;
}

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 100;

const sessionIdParamSchema = z.object({ id: z.string().min(1) });

const messageParamSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

// `imageModel` starts the session with image generation on — the
// first-shortcut default when image shortcuts are configured; otherwise it's
// simply not sent.
const createSessionBodySchema = z
  .object({ model: z.string().min(1), imageModel: z.string().min(1).optional() })
  .strict();

// Any field may be set independently: the aside swaps the models, the pin
// control flips `pinned`, and the rename control sets `title` (`null` clears
// it), all through this one endpoint. Omitting a field leaves it unchanged.
// The working directory is deliberately absent: the assistant moves it
// through its own sandbox-validated tool, and a missing or cleared value
// heals from the configured default when the session is next loaded — there
// is nothing for the app to write.
const patchSessionBodySchema = z
  .object({
    model: z.string().min(1).optional(),
    imageModel: z.string().min(1).nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_LENGTH).nullable().optional(),
  })
  .strict();

const sessionListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SESSION_LIMIT).default(DEFAULT_SESSION_LIMIT),
  // The Pinned feed's one filter: `pinned=true` narrows the list to pinned
  // sessions. There is no unpinned-only view, so no other value is accepted.
  pinned: z.literal("true").optional(),
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

// Whether a message awaits the user's verdict — its last assistant turn called a
// tool that hasn't been allowed or denied yet.
const hasPendingApproval = (parts: UIMessage["parts"]): boolean =>
  parts.some((part) => isToolUIPart(part) && part.state === "approval-requested");

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

/**
 * Build the Hono sub-app for the agentic session surface: model listing,
 * session create/list/get, the streaming turn endpoint, the session article
 * reads, and an optional cancel. Mounted under `/api` by `createApp`,
 * alongside the system routes.
 */
export function sessionsRoutes(deps: SessionsRoutesDeps): Hono {
  const {
    db,
    config,
    registry,
    llmClients,
    bus,
    cancelRegistry,
    mcpRegistry,
    toolPermissions,
    getProviderNames,
  } = deps;
  const app = new Hono();

  // The filesystem tools' sandbox for a turn, read fresh so a kiri.yaml edit
  // applies on the next turn; one read serves the whole turn, so the offered
  // tools and the guidance enumerate the same set. Filtered to directories
  // that exist: a declared entry that isn't on disk can't be browsed, and
  // offering tools (or advertising a root) that every call would then reject
  // reads as broken — with nothing usable, the tools are withheld outright.
  const sandboxDirectories = (): readonly string[] =>
    (deps.getAllowedDirectories?.() ?? []).filter((dir) => existsSync(dir));

  // Where a new session starts working, on the same live-read, must-exist
  // posture: a configured default that isn't on disk yields a session with no
  // working directory rather than one pointing somewhere unusable.
  const defaultWorkingDirectory = (): string | undefined => {
    const dir = deps.getDefaultWorkingDirectory?.();
    return dir !== undefined && existsSync(dir) ? dir : undefined;
  };

  // Why a session's stored working directory can no longer be used — it left
  // the disk, or a kiri.yaml edit moved the sandbox out from under it — or
  // null while it remains valid. With an empty sandbox the check stands down:
  // the filesystem and shell tools are withheld outright then, so a stale
  // value can't send any work astray, and a plain chat shouldn't be blocked
  // by config it no longer uses.
  const staleCwdReason = (cwd: string): string | null => {
    const roots: string[] = [];
    for (const dir of sandboxDirectories()) {
      try {
        roots.push(realpathSync(dir));
      } catch {
        // Skipped: a declared directory that doesn't exist.
      }
    }
    if (roots.length === 0) return null;
    const recovery =
      "it has been cleared, so the next message starts from the configured default (update kiri.yaml first if that isn't right)";
    let real: string;
    try {
      real = realpathSync(cwd);
    } catch {
      return `The session's working directory "${cwd}" no longer exists — ${recovery}.`;
    }
    if (!roots.some((dir) => real === dir || real.startsWith(dir + sep))) {
      return `The session's working directory "${cwd}" is outside the allowed directories — ${recovery}.`;
    }
    return null;
  };

  // Self-heal a session with no working directory — created before a default
  // existed, or whose stale directory a failed turn cleared: stamp the live
  // config default, so the session picks one up the moment it becomes usable.
  // A session that has a directory is returned untouched — a *stale* one is
  // never swapped silently; the turn errors, announces, and clears it instead.
  const withHealedCwd = (session: Session): Session => {
    if (session.cwd !== null) return session;
    const dir = defaultWorkingDirectory();
    return dir === undefined ? session : updateSessionCwd(db, session.id, dir);
  };

  // One registry of in-flight turn streams for this surface: the turn endpoint
  // fills it, the resume endpoint reads it, so a client that reconnects mid-turn
  // rejoins the live response. A caller may inject one to share it.
  const streamRegistry = deps.streamRegistry ?? createStreamRegistry();

  // Decide a run_command call under the "auto" permission: the deterministic
  // screen rules first, and only a screen deferral consults the utility
  // model. No configured utility model means no judgement at all — auto
  // degrades to ask wholesale, screen included, so what the permissions page
  // states holds exactly. Every decision is logged: a command that runs
  // unprompted must stay auditable.
  const shellAutoNeedsApproval = async (input: unknown): Promise<boolean> => {
    // The SDK validates the call against the tool's input schema before any
    // approval gating, so `command` is present and string-typed here.
    const { command, cwd } = input as { command: string; cwd?: string };
    const model = deps.getModelsConfig?.().utility;
    if (model === undefined) return true;
    const screened = screenCommand(command);
    const decision =
      screened.verdict === "judge"
        ? await judgeCommand({
            llmClients,
            model,
            command: screened.command,
            cwd: cwd ?? sandboxDirectories().join(", "),
          })
        : screened;
    console.log(
      `run_command auto: ${decision.verdict} (${decision.reason}): ${JSON.stringify(command)}`,
    );
    return decision.verdict === "ask";
  };

  // Wrap a tool with its standing permission. An "off" tool is withheld from
  // the model entirely (null — never offered). An "ask" tool always pauses
  // for an Allow / Always allow / Deny decision. An "allow" tool runs
  // straight away — except a call the user has already answered this turn,
  // which must still report as needing approval so the SDK honours that
  // answer on resume. (The SDK re-checks `needsApproval` when resuming and
  // denies a call that no longer needs it — so a fresh "allow" would
  // otherwise cancel the very call the user just allowed.) An "auto" tool is
  // decided per call — only the shell tool defines a judgement; on any other
  // tool auto simply asks. `fallback` is the permission that applies when
  // none is recorded: "ask" for MCP tools, a built-in tool's declared
  // default.
  const gate = (
    name: string,
    gatedTool: ToolSet[string],
    fallback: ToolPermission,
  ): ToolSet[string] | null => {
    const permission = toolPermissions.get(name, fallback);
    if (permission === "off") return null;
    return {
      ...gatedTool,
      needsApproval: async (
        input: unknown,
        { toolCallId, messages }: { toolCallId: string; messages: ModelMessage[] },
      ) => {
        if (hasPriorApprovalRequest(messages, toolCallId)) return true;
        if (permission === "allow") return false;
        if (permission === "auto" && name === "run_command") return shellAutoNeedsApproval(input);
        return true;
      },
    };
  };

  // The first-party tool sets bound to a session, before permission gating.
  // The image tools self-gate on selection the same way the filesystem tools
  // self-gate on configuration: no image model on the session, no
  // generate_image offered. The delegate tool is merged separately by each
  // caller — only a top-level session's own turn offers it.
  // The session's working directory as the filesystem tools see it: read live
  // from the row, and written back — with a `session.updated` publish — when
  // set_working_directory moves it.
  const cwdBindingFor = (sessionId: string): SessionCwd => ({
    get: () => getSession(db, sessionId)?.cwd ?? null,
    set: (dir) => {
      const session = updateSessionCwd(db, sessionId, dir);
      bus?.publish({
        type: "session.updated",
        id: sessionId,
        status: session.status as SessionStatus,
      });
    },
  });

  const builtinToolsFor = (sessionId: string): ToolSet => {
    const sandbox = sandboxDirectories();
    return {
      ...skillTools(config),
      ...workflowTools({ db, registry, config, bus, cancelRegistry, llmClients, getProviderNames }),
      ...articleTools(db, sessionId, (event) => bus?.publish(event)),
      ...(sandbox.length > 0 ? filesystemTools(() => sandbox, cwdBindingFor(sessionId)) : {}),
      ...(sandbox.length > 0 ? shellTools(() => sandbox, cwdBindingFor(sessionId)) : {}),
      ...(getSession(db, sessionId)?.imageModel ? imageTools({ db, sessionId, llmClients }) : {}),
    };
  };

  // Withheld from a delegate-driven worker regardless of permission: a worker
  // can't spawn workers, and its deliverable is the report — articles it wrote
  // would ride a hidden session rather than a surface the user sees.
  const childWithheld = new Set(["delegate", "create_article", "replace_article", "edit_article"]);

  // The tools a delegate-driven child turn runs with: the same catalogue
  // narrowed to tools whose standing permission is "allow", offered ungated.
  // A worker runs unattended — no approval prompt can surface mid-delegation —
  // so a tool the user hasn't already allowed to run unprompted is simply
  // absent. An "auto" tool is likewise absent: its judgement can ask, and a
  // worker has no one to ask. Delegation therefore never widens what runs
  // without asking.
  const childActiveTools = (childSessionId: string): ToolSet => {
    const tools: ToolSet = {};
    for (const [name, mcpTool] of Object.entries(mcpRegistry?.tools() ?? {})) {
      if (toolPermissions.get(name, "ask") === "allow") tools[name] = mcpTool;
    }
    const builtin = builtinToolsFor(childSessionId);
    for (const { name, defaultPermission } of BUILTIN_TOOLS) {
      const builtinTool = builtin[name];
      if (builtinTool === undefined || childWithheld.has(name)) continue;
      if (toolPermissions.get(name, defaultPermission) === "allow") tools[name] = builtinTool;
    }
    return tools;
  };

  // The turn dependencies a delegate-driven child session runs against: its
  // allow-only tool set and the worker system prompt over those tools (the
  // prompt builder chooses the worker layer by the child's lineage). Shares
  // this surface's stream registry and cancel registry, so a reconnecting
  // client can rejoin the child's live stream and a cancel reaches its turn.
  const childTurnDeps = (childSessionId: string): RunTurnDeps => {
    const tools = childActiveTools(childSessionId);
    return {
      db,
      llmClients,
      bus,
      cancelRegistry,
      streamRegistry,
      buildSystemPrompt: createSystemPromptBuilder(
        config,
        Object.keys(tools),
        sandboxDirectories(),
        [],
        listSkills(config),
      ),
      tools,
    };
  };

  // The tools offered to a turn: the live MCP server tools plus the
  // first-party sets. Read per turn (not once) so a config reload that adds
  // or drops MCP servers, and a permission change since the last turn, are
  // both reflected on the next turn. Every tool rides the same standing
  // permission machinery; what differs is the default, declared per built-in
  // tool in BUILTIN_TOOLS — "allow" for tools that only read or write kiri's
  // own data (the user's request in chat is the authorisation), "ask" for
  // run_workflow and run_command, which execute scripts. Built-in tools are
  // merged after the gated MCP set, so they take the name on a collision.
  // The filesystem and shell tools self-gate on configuration like an MCP
  // server: no declared directories, no tools — a BUILTIN_TOOLS entry absent
  // from the merged set is simply withheld.
  const activeTools = (sessionId: string): ToolSet => {
    const tools: ToolSet = {};
    for (const [name, mcpTool] of Object.entries(mcpRegistry?.tools() ?? {})) {
      const offered = gate(name, mcpTool, "ask");
      if (offered !== null) tools[name] = offered;
    }
    const builtin: ToolSet = {
      ...builtinToolsFor(sessionId),
      // A worker can't spawn workers: delegate is offered only to a session
      // with no parent. Delegate models, when configured, make the worker's
      // model a required role choice, read live so a kiri.yaml edit applies
      // on the next turn.
      ...(getSession(db, sessionId)?.parentSessionId
        ? {}
        : delegateTool({
            db,
            parentSessionId: sessionId,
            childTurnDeps,
            bus,
            cancelRegistry,
            delegates: deps.getModelsConfig?.().delegates,
          })),
    };
    for (const { name, defaultPermission } of BUILTIN_TOOLS) {
      const builtinTool = builtin[name];
      if (builtinTool === undefined) continue;
      const offered = gate(name, builtinTool, defaultPermission);
      if (offered !== null) tools[name] = offered;
    }
    return tools;
  };

  // The listing carries the configured model shortcuts alongside the models,
  // so the pickers can pin them and new sessions can start on the first one.
  // Read live, so a kiri.yaml edit is reflected on the next fetch. The
  // reasoning flag stays server-side: it drives whether a turn sends provider
  // reasoning parameters, and nothing client-side consumes it.
  app.get("/models", async (c) => {
    const { models, failures } = await llmClients.listModels();
    return c.json({
      models: models.map(({ reasoning: _reasoning, ...model }) => model),
      failures,
      shortcuts: deps.getModelsConfig?.().shortcuts ?? {},
    });
  });

  app.post(
    "/sessions",
    zValidator("json", createSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { model, imageModel } = c.req.valid("json");
      // Validate the models resolve now, at create time, so a bad id fails the
      // create with the resolver's own message rather than a later turn.
      try {
        llmClients.resolveModel(model);
        if (imageModel !== undefined) llmClients.resolveModel(imageModel);
      } catch (cause) {
        return c.json({ error: cause instanceof Error ? cause.message : "invalid model" }, 400);
      }
      const cwd = defaultWorkingDirectory();
      const session = createSession(db, model, {
        ...(imageModel !== undefined ? { imageModel } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
      });
      bus?.publish({ type: "session.started", id: session.id });
      return c.json({ session }, 201);
    },
  );

  app.get(
    "/sessions",
    zValidator("query", sessionListQuerySchema, onZodFail("invalid query")),
    (c) => {
      const { cursor, limit, pinned } = c.req.valid("query");

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
          and(
            // Child sessions are part of their parent's transcript, not
            // standalone activity — the list shows only top-level sessions.
            isNull(sessionsTable.parentSessionId),
            pinned ? eq(sessionsTable.pinned, true) : undefined,
            anchor
              ? or(
                  lt(sessionsTable.startedAt, anchor.startedAt),
                  and(
                    eq(sessionsTable.startedAt, anchor.startedAt),
                    lt(sessionsTable.id, anchor.id),
                  ),
                )
              : undefined,
          ),
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
      // Each row's written articles, batched across the page — the projection
      // mirrors the activity feed's session enrichment so both surfaces
      // render the same rows.
      const articlesBySessionId = new Map<
        string | null,
        { slug: string; name: string; heading: string | null; createdAt: Date }[]
      >();
      if (rows.length > 0) {
        const articleRows = db
          .select()
          .from(articles)
          .where(
            inArray(
              articles.sessionId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(articles.createdAt))
          .all();
        for (const article of articleRows) {
          const entry = {
            slug: article.slug,
            name: article.name,
            heading: extractFirstHeading(article.contentMd),
            createdAt: article.createdAt,
          };
          const list = articlesBySessionId.get(article.sessionId);
          if (list) list.push(entry);
          else articlesBySessionId.set(article.sessionId, [entry]);
        }
      }
      const sessions = rows.map((row) => ({
        ...row,
        preview: previews.get(row.id) ?? null,
        articles: articlesBySessionId.get(row.id) ?? [],
      }));
      return c.json({ sessions, nextCursor });
    },
  );

  app.get(
    "/sessions/:id/articles",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getSession(db, id)) return c.json({ error: `session "${id}" not found` }, 404);
      // The same projection as a run's article list: the body is fetched only
      // to derive the heading, never echoed — the detail route serves it.
      const rows = db
        .select()
        .from(articles)
        .where(eq(articles.sessionId, id))
        .orderBy(asc(articles.createdAt))
        .all();
      return c.json({
        articles: rows.map((article) => ({
          slug: article.slug,
          name: article.name,
          heading: extractFirstHeading(article.contentMd),
          createdAt: article.createdAt,
        })),
      });
    },
  );

  app.get(
    "/sessions/:id/articles/:slug",
    zValidator("param", articleParamSchema, onZodFail("invalid article slug")),
    (c) => {
      const { id, slug } = c.req.valid("param");
      if (!getSession(db, id)) return c.json({ error: `session "${id}" not found` }, 404);
      const article = db
        .select()
        .from(articles)
        .where(and(eq(articles.sessionId, id), eq(articles.slug, slug)))
        .get();
      if (!article) {
        return c.json({ error: `article "${slug}" not found on session "${id}"` }, 404);
      }
      return c.json({
        id: article.id,
        sessionId: article.sessionId,
        slug: article.slug,
        name: article.name,
        contentMd: article.contentMd,
        createdAt: article.createdAt,
        heading: extractFirstHeading(article.contentMd),
      });
    },
  );

  app.get(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      return c.json({ session: withHealedCwd(session), messages: getSessionMessages(db, id) });
    },
  );

  // The sessions a session's delegate calls have spawned. Children are hidden
  // from the list and feed, so this is how the transcript finds the child
  // behind a delegate tool call — matched client-side on parentToolCallId —
  // including one still mid-run after a reload.
  app.get(
    "/sessions/:id/children",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getSession(db, id)) return c.json({ error: `session "${id}" not found` }, 404);
      return c.json({ children: getSessionChildren(db, id) });
    },
  );

  app.get(
    "/sessions/:id/stream",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      // Resume an in-flight turn: replay what's buffered, then stream live. With
      // no turn in flight there's nothing to rejoin — a 204 tells the client's
      // resume to stand down and read the settled turn from storage instead.
      const body = streamRegistry.subscribe(c.req.valid("param").id);
      if (!body) return c.body(null, 204);
      return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
    },
  );

  app.patch(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", patchSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { id } = c.req.valid("param");
      const { model, imageModel, effort, pinned, title } = c.req.valid("json");
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
      // The image model follows the same contract; `null` turns generation off.
      if (imageModel !== undefined) {
        if (imageModel !== null) {
          try {
            llmClients.resolveModel(imageModel);
          } catch (cause) {
            return c.json({ error: cause instanceof Error ? cause.message : "invalid model" }, 400);
          }
        }
        updateSessionImageModel(db, id, imageModel);
      }
      // Effort needs no resolution — the enum is the whole contract; the turn
      // maps it to provider parameters (or omits them) when it runs.
      if (effort !== undefined) updateSessionEffort(db, id, effort);
      if (pinned !== undefined) setSessionPinned(db, id, pinned);
      if (title !== undefined) updateSessionTitle(db, id, title);
      const updated = getSession(db, id) as typeof session;
      // The turn endpoint resolves the model per turn, so a change applies
      // from the next turn. Announce it like any other session change so the
      // feed and the open chat refresh; status is unchanged.
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
      let session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // Reject only a concurrent turn (one already in flight). A session is
      // long-lived and resumable: after an idle, failed, or cancelled turn it
      // accepts the next message, picking the conversation back up.
      if (session.status === "running") {
        return c.json({ error: `session "${id}" already has a turn in flight` }, 409);
      }
      // A stale working directory fails the turn before anything persists —
      // erroring loudly beats silently working somewhere other than where the
      // session says it is. Clearing it as part of the announcement is what
      // lets the next message self-heal from the configured default: the user
      // hears about the move before any work runs under it, and no manual
      // reset is ever needed.
      if (session.cwd !== null) {
        const stale = staleCwdReason(session.cwd);
        if (stale !== null) {
          updateSessionCwd(db, id, null);
          bus?.publish({ type: "session.updated", id, status: session.status as SessionStatus });
          return c.json({ error: stale }, 409);
        }
      }
      session = withHealedCwd(session);

      const parts = message.parts as UIMessage["parts"];
      const priorMessages = getSessionMessages(db, id);
      const last = priorMessages.at(-1);
      const pending =
        last?.role === "assistant" && hasPendingApproval(last.parts as UIMessage["parts"]);

      // Resolve the live, approval-gated tools for this turn and compose the
      // system prompt from their names so the core layer's tool guidance matches
      // what the model is actually offered; the sandbox rides along so the
      // filesystem and shell guidance can enumerate the reachable roots.
      const tools = activeTools(id);
      const buildSystemPrompt = createSystemPromptBuilder(
        config,
        Object.keys(tools),
        sandboxDirectories(),
        configuredDelegateRoles(deps.getModelsConfig?.().delegates),
        listSkills(config),
      );
      const turnDeps = {
        db,
        llmClients,
        bus,
        cancelRegistry,
        streamRegistry,
        buildSystemPrompt,
        tools,
      };

      // Persistence rides the stream's completion (the turn's `onFinish`), so the
      // route just hands back the streamed response. The turn is drained
      // server-side, so a client that disconnects doesn't cancel it; only an
      // explicit cancel through `POST /api/sessions/:id/cancel` does.

      // An assistant message carries the user's verdicts on a paused turn's tool
      // calls: resume it rather than starting a new turn.
      if (message.role === "assistant") {
        if (!pending) {
          return c.json({ error: `session "${id}" has no pending tool approval to resolve` }, 409);
        }
        const { response } = await resumeTurn(turnDeps, {
          session,
          approvals: extractApprovals(parts),
        });
        return response;
      }

      // A new user message can't start while a tool approval is still pending —
      // the model can't continue past an unanswered tool call.
      if (pending) {
        return c.json(
          { error: `session "${id}" has a pending tool approval; respond to it first` },
          409,
        );
      }

      // A session names itself off its opening message: a one-off generation
      // against the utility model (the session's own model when none is
      // configured), fired alongside the turn rather than awaited by it, so
      // the title lands in the list and feed while the reply is still
      // streaming. First message only — a session left untitled by a failed
      // call stays untitled rather than fighting a user who cleared the title.
      const userText = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (session.title === null && priorMessages.length === 0 && userText !== "") {
        void generateSessionTitle({
          db,
          llmClients,
          sessionId: id,
          userText,
          model: deps.getModelsConfig?.().utility ?? session.model,
          publish: (event) => bus?.publish(event),
        });
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
