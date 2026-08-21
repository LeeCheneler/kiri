import { existsSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { zValidator } from "@hono/zod-validator";
import {
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
  UI_MESSAGE_STREAM_HEADERS,
  isToolUIPart,
} from "ai";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import { type ModelsConfig, configuredDelegateRoles } from "../config/schema.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, sessions as sessionsTable } from "../db/schema.ts";
import type { EventBus, SessionStatus } from "../events/index.ts";
import { EFFORT_LEVELS, type LlmClients } from "../llm/index.ts";
import { c, createLogger } from "../log.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import { getProject, listProjectArticles } from "../projects/store.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import {
  BUILTIN_TOOLS,
  type CommandLearning,
  type RunTurnDeps,
  SESSION_TITLE_MAX_LENGTH,
  type Session,
  type SessionCwd,
  type StreamRegistry,
  type ToolApprovalDecision,
  type ToolPermission,
  type ToolPermissionStore,
  articleTools,
  buildSessionListEntries,
  createCommandLearning,
  createSession,
  createStreamRegistry,
  createSystemPromptBuilder,
  delegateTool,
  deleteInboxItems,
  deleteMessagesFrom,
  deleteSession,
  enqueueInboxItem,
  filesystemTools,
  generateSessionTitle,
  generateSuggestedReplies,
  getSession,
  getSessionChildren,
  getSessionLabels,
  getSessionLastActivity,
  getSessionMessages,
  imageTools,
  judgeCommand,
  listMemories,
  listProjectMemories,
  listSkills,
  liveConsoleEmitter,
  memoryTools,
  messageParentTool,
  mountDelegationMessaging,
  pendingInboxItems,
  projectTools,
  resumeTurn,
  runTurn,
  screenCommand,
  shellTools,
  skillTools,
  summariseTaskList,
  taskTools,
  tidyDraft,
  updateSessionCwd,
  updateSessionEffort,
  updateSessionImageModel,
  updateSessionModel,
  updateSessionTitle,
  workflowTools,
} from "../sessions/index.ts";
import type { Registry } from "../workflows/index.ts";
import { articleParamSchema, onZodFail } from "./shared.ts";

const log = createLogger("shell");

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
  /**
   * The auto shell permission's learning loop: decisions and user verdicts
   * feed the judgement log, and distilled precedent feeds back into the
   * judge. Defaults to a file-backed instance under `.kiri`; injectable for
   * tests.
   */
  commandLearning?: CommandLearning;
}

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 100;

const sessionIdParamSchema = z.object({ id: z.string().min(1) });

const messageParamSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

// `imageModel` starts the session with image generation on — the
// first-shortcut default when image shortcuts are configured; otherwise it's
// simply not sent. `projectId` creates the session within a project — set at
// creation and never moved, so it has no PATCH counterpart.
const createSessionBodySchema = z
  .object({
    model: z.string().min(1),
    imageModel: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict();

const tidyBodySchema = z.object({ text: z.string().min(1) });

// A message queued for a running turn. Text only: images can't ride the inbox,
// and the client blocks queueing them rather than dropping parts.
const inboxBodySchema = z.object({ text: z.string().trim().min(1) }).strict();

const inboxItemParamSchema = z.object({ id: z.string().min(1), itemId: z.string().min(1) });

// Any field may be set independently: the aside swaps the models and the
// rename control sets `title` (`null` clears it), both through this one
// endpoint. Omitting a field leaves it unchanged.
// The working directory is deliberately absent: the assistant moves it
// through its own sandbox-validated tool, and a missing or cleared value
// heals from the configured default when the session is next loaded — there
// is nothing for the app to write.
const patchSessionBodySchema = z
  .object({
    model: z.string().min(1).optional(),
    imageModel: z.string().min(1).nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_LENGTH).nullable().optional(),
  })
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
    let real: string;
    try {
      real = realpathSync(cwd);
    } catch {
      return `The session's working directory "${cwd}" no longer exists.`;
    }
    if (!roots.some((dir) => real === dir || real.startsWith(dir + sep))) {
      return `The session's working directory "${cwd}" is outside the allowed directories.`;
    }
    return null;
  };

  // What the model must hear when a turn heals a stale working directory:
  // why the old one is unusable, where the session now runs (or that it has
  // nowhere until one is set), and that the user should be told — the move
  // happened out from under the conversation, so the model is the one who
  // announces it.
  const cwdMoveNotice = (reason: string, healed: string | null): string =>
    healed !== null
      ? `${reason} The session has been moved to the configured default working directory, "${healed}" — relative paths and commands now resolve there. Tell the user about the move before doing filesystem or shell work; if that isn't the right place, move with set_working_directory or have them update kiri.yaml.`
      : `${reason} No usable default working directory is configured, so the session now has none — relative paths are rejected until one is set. Tell the user, and either move with set_working_directory or have them set filesystem.default_working_directory in kiri.yaml.`;

  // Self-heal a session with no working directory — created before a default
  // existed, or whose stale directory a turn just cleared: stamp the live
  // config default, so the session picks one up the moment it becomes usable.
  // A session that has a directory is returned untouched — a *stale* one is
  // never swapped silently; the turn clears it, heals it here, and announces
  // the move to the model instead.
  const withHealedCwd = (session: Session): Session => {
    if (session.cwd !== null) return session;
    const dir = defaultWorkingDirectory();
    return dir === undefined ? session : updateSessionCwd(db, session.id, dir);
  };

  // One registry of in-flight turn streams for this surface: the turn endpoint
  // fills it, the resume endpoint reads it, so a client that reconnects mid-turn
  // rejoins the live response. A caller may inject one to share it.
  const streamRegistry = deps.streamRegistry ?? createStreamRegistry();

  // The learning loop around the auto shell permission: every decision and
  // user verdict lands in the judgement log, and the distilled precedent is
  // read back into each judgement.
  const commandLearning =
    deps.commandLearning ??
    createCommandLearning({
      llmClients,
      getModel: () => deps.getModelsConfig?.().utility,
      logFile: config.commandJudgementsFile(),
      guidanceFile: config.commandGuidanceFile(),
    });

  // Decide a run_command call under the "auto" permission: the deterministic
  // screen rules first, and only a screen deferral consults the utility
  // model. No configured utility model means no judgement at all — auto
  // degrades to ask wholesale, screen included, so what the permissions page
  // states holds exactly. Every decision is logged: a command that runs
  // unprompted must stay auditable.
  const shellAutoNeedsApproval = async (input: unknown, toolCallId: string): Promise<boolean> => {
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
            guidance: commandLearning.guidance(),
          })
        : screened;
    const verdict = decision.verdict === "allow" ? c.green("allow") : c.yellow("ask");
    log.info(`run_command auto ${c.bold(verdict)} ${c.cyan(command)}`);
    log.info(`  ${c.dim(decision.reason)}`);
    // The raw command, not the screened form — precedent is about what the
    // user saw asked.
    commandLearning.recordJudgement({
      toolCallId,
      command,
      cwd: cwd ?? sandboxDirectories().join(", "),
      verdict: decision.verdict,
      reason: decision.reason,
      source: screened.verdict === "judge" ? "judge" : "screen",
    });
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
        if (permission === "auto" && name === "run_command") {
          return shellAutoNeedsApproval(input, toolCallId);
        }
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

  // The prompt-layer context for a session's project: its name, the corpus
  // index the prompt map lists — each slug titled by its body's first heading,
  // falling back to the display name — the project's memory index, and its
  // standing instructions. Null for projectless sessions.
  const projectContextFor = (sessionId: string) => {
    const projectId = getSession(db, sessionId)?.projectId ?? null;
    const project = projectId !== null ? getProject(db, projectId) : undefined;
    if (!project) return null;
    return {
      name: project.name,
      articles: listProjectArticles(db, project.id).map((article) => ({
        slug: article.slug,
        heading: article.heading ?? article.name,
      })),
      memories: listProjectMemories(db, project.id),
      instructions: project.instructions,
      tasks: summariseTaskList(db, project.id),
    };
  };

  // `writer` is the owning turn's stream writer, threaded here — the one
  // tool-assembly point — so any tool can emit live progress parts while it
  // runs; today only run_command's live console does. Absent (a writer-less
  // construction, used to enumerate tool names for the system prompt), the
  // tools run without a live feed.
  const builtinToolsFor = (sessionId: string, writer?: UIMessageStreamWriter): ToolSet => {
    const sandbox = sandboxDirectories();
    return {
      ...skillTools(config),
      ...workflowTools({ db, registry, config, bus, cancelRegistry, llmClients, getProviderNames }),
      ...articleTools(db, sessionId, getSession(db, sessionId)?.projectId ?? null, (event) =>
        bus?.publish(event),
      ),
      ...memoryTools(db, getSession(db, sessionId)?.projectId ?? null, (event) =>
        bus?.publish(event),
      ),
      ...projectTools(db, getSession(db, sessionId)?.projectId ?? null, (event) =>
        bus?.publish(event),
      ),
      ...taskTools(db, getSession(db, sessionId)?.projectId ?? null, (event) =>
        bus?.publish(event),
      ),
      ...(sandbox.length > 0 ? filesystemTools(() => sandbox, cwdBindingFor(sessionId)) : {}),
      ...(sandbox.length > 0
        ? shellTools(
            () => sandbox,
            cwdBindingFor(sessionId),
            writer === undefined
              ? {}
              : { liveConsole: (toolCallId) => liveConsoleEmitter(writer, toolCallId) },
          )
        : {}),
      ...(getSession(db, sessionId)?.imageModel ? imageTools({ db, sessionId, llmClients }) : {}),
    };
  };

  // Withheld from a delegate-driven worker regardless of permission: a worker
  // can't spawn or steer workers, and its deliverable rides message_parent —
  // articles it wrote would land on a hidden session rather than a surface
  // the user sees. Memory
  // writes stay with the user-facing conversation too: a worker recalls
  // memories but never rewrites the durable record, and the project's standing
  // instructions — which a worker doesn't even carry — are the user's to change
  // through the conversation they're in. The task list follows the same rule:
  // a worker reads it but leaves its upkeep to the conversation.
  const childWithheld = new Set([
    "delegate",
    "message_worker",
    "create_article",
    "replace_article",
    "edit_article",
    "delete_article",
    "save_memory",
    "delete_memory",
    "update_project_instructions",
    "add_task",
    "update_task",
    "delete_task",
    "create_task_group",
    "update_task_group",
    "delete_task_group",
  ]);

  // The tools a delegate-driven child turn runs with: the same catalogue
  // narrowed to tools whose standing permission is "allow", offered ungated.
  // A worker runs unattended — no approval prompt can surface mid-delegation —
  // so a tool the user hasn't already allowed to run unprompted is simply
  // absent. An "auto" tool is likewise absent: its judgement can ask, and a
  // worker has no one to ask. Delegation therefore never widens what runs
  // without asking.
  const childActiveTools = (childSessionId: string, writer?: UIMessageStreamWriter): ToolSet => {
    const tools: ToolSet = {};
    for (const [name, mcpTool] of Object.entries(mcpRegistry?.tools() ?? {})) {
      if (toolPermissions.get(name, "ask") === "allow") tools[name] = mcpTool;
    }
    const builtin = {
      ...builtinToolsFor(childSessionId, writer),
      // The worker's voice: everything it reports, asks, and delivers rides
      // message_parent back to the session that delegated its task.
      ...messageParentTool({ db, childSessionId, bus }),
    };
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
    // The prompt needs the tool names before the turn's stream (and so its
    // writer) exists; the set the model runs with is rebuilt against the
    // writer when the stream starts. Both constructions gate identically, so
    // the names always match.
    const toolNames = Object.keys(childActiveTools(childSessionId));
    return {
      db,
      llmClients,
      bus,
      cancelRegistry,
      streamRegistry,
      buildSystemPrompt: createSystemPromptBuilder(
        config,
        toolNames,
        sandboxDirectories(),
        [],
        listSkills(config),
        listMemories(db),
        projectContextFor(childSessionId),
      ),
      tools: ({ writer }) => childActiveTools(childSessionId, writer),
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
  const activeTools = (sessionId: string, writer?: UIMessageStreamWriter): ToolSet => {
    const tools: ToolSet = {};
    for (const [name, mcpTool] of Object.entries(mcpRegistry?.tools() ?? {})) {
      const offered = gate(name, mcpTool, "ask");
      if (offered !== null) tools[name] = offered;
    }
    const builtin: ToolSet = {
      ...builtinToolsFor(sessionId, writer),
      // A worker can't spawn workers: the delegation tools (delegate and
      // message_worker) are offered only to a session with no parent, and
      // message_parent only to one with a parent to message. Delegate
      // models, when configured, make the worker's model a required role
      // choice, read live so a kiri.yaml edit applies on the next turn.
      ...(getSession(db, sessionId)?.parentSessionId
        ? messageParentTool({ db, childSessionId: sessionId, bus })
        : delegateTool({
            db,
            parentSessionId: sessionId,
            childTurnDeps,
            bus,
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

  // The standard turn dependencies a session runs against — the live,
  // approval-gated catalogue over the standard system prompt (whose builder
  // picks the worker layer for a child by lineage). The turn endpoint wraps
  // this with its one-off stale-cwd notice when a heal happened.
  const standardTurnDeps = (sessionId: string): RunTurnDeps => {
    // Resolve the tool names for the system prompt so the core layer's tool
    // guidance matches what the model is actually offered; the set the model
    // runs with is rebuilt against the turn's stream writer when the stream
    // starts. Both constructions gate identically, so the names always match.
    const toolNames = Object.keys(activeTools(sessionId));
    return {
      db,
      llmClients,
      bus,
      cancelRegistry,
      streamRegistry,
      buildSystemPrompt: createSystemPromptBuilder(
        config,
        toolNames,
        sandboxDirectories(),
        configuredDelegateRoles(deps.getModelsConfig?.().delegates),
        listSkills(config),
        listMemories(db),
        projectContextFor(sessionId),
      ),
      tools: ({ writer }) => activeTools(sessionId, writer),
    };
  };

  // The turn dependencies a message-driven wake runs against, chosen by
  // lineage: a delegated child wakes as the unattended worker it is (the
  // allow-only tool set), a top-level session as itself. Distinct from the
  // turn endpoint's choice — a user driving a child's page directly is there
  // to answer approvals, so that path keeps the gated catalogue.
  const turnDepsFor = (sessionId: string): RunTurnDeps =>
    getSession(db, sessionId)?.parentSessionId != null
      ? childTurnDeps(sessionId)
      : standardTurnDeps(sessionId);

  // The delegation messaging loop: a message queued to a session that is out
  // of a turn wakes it, and a child whose turn fails notices its parent.
  // Lives for the app's lifetime, like the surface's routes themselves.
  if (bus) mountDelegationMessaging({ db, bus, turnDepsFor });

  // The listing carries the configured model shortcuts alongside the models,
  // so the pickers can pin them and new sessions can start on the first one,
  // and the utility model, so the client knows which utility-driven actions
  // to offer. Read live, so a kiri.yaml edit is reflected on the next fetch. The
  // reasoning flag stays server-side: it drives whether a turn sends provider
  // reasoning parameters, and nothing client-side consumes it.
  app.get("/models", async (c) => {
    const { models, failures } = await llmClients.listModels();
    return c.json({
      models: models.map(({ reasoning: _reasoning, ...model }) => model),
      failures,
      shortcuts: deps.getModelsConfig?.().shortcuts ?? {},
      utility: deps.getModelsConfig?.().utility,
    });
  });

  // Rewrite a composer draft as the clean message its writer meant, against
  // the utility model. Nothing is persisted: the tidied text goes back to the
  // requesting client, which decides whether to keep it. No utility model
  // configured is the feature's off switch — the client hides the action, so
  // a request without one is a plain 400 rather than a session-model spend.
  app.post("/tidy", zValidator("json", tidyBodySchema, onZodFail("invalid draft")), async (c) => {
    const model = deps.getModelsConfig?.().utility;
    if (model === undefined) return c.json({ error: "no utility model configured" }, 400);
    const { text } = c.req.valid("json");
    return c.json({ text: await tidyDraft({ llmClients, model, text }) });
  });

  app.post(
    "/sessions",
    zValidator("json", createSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { model, imageModel, projectId } = c.req.valid("json");
      // Validate the models resolve now, at create time, so a bad id fails the
      // create with the resolver's own message rather than a later turn.
      try {
        llmClients.resolveModel(model);
        if (imageModel !== undefined) llmClients.resolveModel(imageModel);
      } catch (cause) {
        return c.json({ error: cause instanceof Error ? cause.message : "invalid model" }, 400);
      }
      // The project must exist at create — membership is set once here, so a
      // stale id fails the create rather than minting an orphaned session.
      if (projectId !== undefined && !getProject(db, projectId)) {
        return c.json({ error: `project "${projectId}" not found` }, 400);
      }
      const cwd = defaultWorkingDirectory();
      const session = createSession(db, model, {
        ...(imageModel !== undefined ? { imageModel } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      });
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
          and(
            // Child sessions are part of their parent's transcript, not
            // standalone activity — the list shows only top-level sessions.
            isNull(sessionsTable.parentSessionId),
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
      return c.json({ sessions: buildSessionListEntries(db, rows), nextCursor });
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

  app.delete(
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
      db.delete(articles).where(eq(articles.id, article.id)).run();
      bus?.publish({ type: "article.deleted", sessionId: id, slug });
      return c.body(null, 204);
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
        // The reading view situates the article under its session by name, so
        // the label rides along rather than costing a second round-trip.
        sessionLabel: getSessionLabels(db, [id]).get(id) ?? id.slice(0, 8),
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
      const parentId = session.parentSessionId;
      return c.json({
        session: withHealedCwd(session),
        messages: getSessionMessages(db, id),
        // The undelivered backlog rides the detail so queued messages stay
        // visible across reloads and other views — the inbox table, not any
        // client's local state, is the queue's source of truth.
        inbox: pendingInboxItems(db, id),
        // A delegated child names the session that spawned it so its page can
        // link back up; a top-level session carries null.
        parent:
          parentId !== null
            ? { id: parentId, label: getSessionLabels(db, [parentId]).get(parentId) ?? parentId }
            : null,
      });
    },
  );

  // The sessions a session's delegate calls have spawned. Children are hidden
  // from the list and feed, so this is how the transcript finds the child
  // behind a delegate tool call — matched client-side on parentToolCallId —
  // including one still mid-run after a reload. Each child carries when it
  // last moved — its newest message, else its start — so the aside can read
  // recency at a glance without loading any child's transcript.
  app.get(
    "/sessions/:id/children",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getSession(db, id)) return c.json({ error: `session "${id}" not found` }, 404);
      const children = getSessionChildren(db, id);
      const lastActivity = getSessionLastActivity(
        db,
        children.map((child) => child.id),
      );
      return c.json({
        children: children.map((child) => ({
          ...child,
          lastActivityAt: lastActivity.get(child.id) ?? child.startedAt,
        })),
      });
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

  // Tap-to-send replies to the session's settled last turn, generated on
  // demand against the utility model. Nothing is persisted or pushed — the
  // chips are the requesting client's affair, so a moment nobody is looking
  // at costs nothing. Every "not now" case is a plain empty list rather than
  // an error: no utility model configured (the feature's off switch), a
  // delegated child, a turn in flight or awaiting approval (the approval
  // prompt is the reply surface), or a last message a chip can't answer —
  // absence of chips is the common, first-class outcome.
  app.get(
    "/sessions/:id/suggested-replies",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    async (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      const none = { replies: [] as string[] };
      const model = deps.getModelsConfig?.().utility;
      if (model === undefined) return c.json(none);
      if (session.parentSessionId !== null || session.status !== "idle") return c.json(none);
      const last = getSessionMessages(db, id).at(-1);
      if (!last || last.role !== "assistant") return c.json(none);
      const parts = last.parts as UIMessage["parts"];
      if (hasPendingApproval(parts)) return c.json(none);
      const assistantText = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (assistantText === "") return c.json(none);
      const replies = await generateSuggestedReplies({ llmClients, model, assistantText });
      return c.json({ replies });
    },
  );

  app.patch(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", patchSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { id } = c.req.valid("param");
      const { model, imageModel, effort, title } = c.req.valid("json");
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
      // A stale working directory — gone from disk (a deleted worktree), or
      // moved outside the sandbox by a kiri.yaml edit — heals before the turn
      // runs rather than failing it: the session falls back to the configured
      // default (or to none when no usable default exists) and this turn's
      // system prompt announces the move, so the model works from the new
      // location knowingly and relays it to the user. Nothing ever runs under
      // the stale directory, and no manual reset is needed.
      let staleCwd: string | null = null;
      if (session.cwd !== null) {
        staleCwd = staleCwdReason(session.cwd);
        if (staleCwd !== null) session = updateSessionCwd(db, id, null);
      }
      session = withHealedCwd(session);
      if (staleCwd !== null) {
        bus?.publish({ type: "session.updated", id, status: session.status as SessionStatus });
      }
      const cwdNotice = staleCwd === null ? undefined : cwdMoveNotice(staleCwd, session.cwd);

      const parts = message.parts as UIMessage["parts"];
      const priorMessages = getSessionMessages(db, id);
      const last = priorMessages.at(-1);
      const pending =
        last?.role === "assistant" && hasPendingApproval(last.parts as UIMessage["parts"]);

      // A healed working directory rides this turn's prompt as a one-off
      // notice; from the next turn the standard working-directory line is
      // accurate on its own.
      const base = standardTurnDeps(id);
      const turnDeps: RunTurnDeps =
        cwdNotice === undefined
          ? base
          : {
              ...base,
              buildSystemPrompt: (s: Session) => `${base.buildSystemPrompt?.(s)}\n\n${cwdNotice}`,
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
        // Every answered run_command feeds the learning loop — under "ask" as
        // much as "auto", since an approval is precedent either way.
        for (const part of parts) {
          if (
            isToolUIPart(part) &&
            part.state === "approval-responded" &&
            part.type === "tool-run_command"
          ) {
            commandLearning.recordResolution({
              toolCallId: part.toolCallId,
              command: (part.input as { command?: string })?.command ?? "",
              approved: part.approval.approved,
            });
          }
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
      // A delegated worker runs detached from its parent's turns, so its
      // in-flight turn blocks the parent's delete the same way.
      if (session.status === "running") {
        return c.json({ error: `session "${id}" has a turn in flight; cancel it first` }, 409);
      }
      if (getSessionChildren(db, id).some((child) => child.status === "running")) {
        return c.json(
          { error: `session "${id}" has a delegated worker running; cancel it first` },
          409,
        );
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
      // Other views only learn of transcript changes from the bus, and a plain
      // delete — unlike an edit-and-resend — has no follow-up turn to announce
      // one, so publish the change here.
      bus?.publish({ type: "session.updated", id, status: session.status as SessionStatus });
      return c.body(null, 204);
    },
  );

  app.post(
    "/sessions/:id/inbox",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", inboxBodySchema, onZodFail("invalid message")),
    (c) => {
      const { id } = c.req.valid("param");
      const { text } = c.req.valid("json");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // Queueing only makes sense against a turn that can still deliver it:
      // one running now, or paused awaiting a tool approval (delivered on
      // resume). Anything else takes a normal message — the 409 tells the
      // client it lost that race and should send instead of queue.
      if (session.status !== "running" && session.status !== "waiting") {
        return c.json({ error: `session "${id}" has no turn in flight to queue for` }, 409);
      }
      const item = enqueueInboxItem(db, id, { source: "user", text });
      bus?.publish({ type: "session.inbox.queued", sessionId: id });
      return c.json({ item }, 201);
    },
  );

  app.delete(
    "/sessions/:id/inbox/:itemId",
    zValidator("param", inboxItemParamSchema, onZodFail("invalid session or item id")),
    (c) => {
      const { id, itemId } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session) return c.json({ error: `session "${id}" not found` }, 404);
      // Withdrawing races delivery, and delivery wins: once the turn has
      // consumed the item its row is gone, so the 404 doubles as the "already
      // delivered" signal the client's auto-promotion keys off.
      if (!pendingInboxItems(db, id).some((item) => item.id === itemId)) {
        return c.json({ error: `message "${itemId}" is not queued for session "${id}"` }, 404);
      }
      deleteInboxItems(db, [itemId]);
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
