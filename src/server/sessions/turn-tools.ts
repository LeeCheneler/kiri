import type { ModelMessage, ToolSet, UIMessageStreamWriter } from "ai";
import type { ConfigService, ConfigSnapshot } from "../config/service.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { c, createLogger } from "../log.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import type { Registry } from "../workflows/index.ts";
import { articleTools } from "./article-tools.ts";
import { BUILTIN_TOOLS } from "./builtin-tools.ts";
import { judgeCommand } from "./command-judge.ts";
import type { CommandLearning } from "./command-learning.ts";
import { screenCommand } from "./command-screen.ts";
import { delegateTool, messageParentTool } from "./delegate-tool.ts";
import { type SessionCwd, filesystemTools } from "./filesystem-tools.ts";
import { imageTools } from "./image-tools.ts";
import type { InstructionContext } from "./instruction-context.ts";
import { knowledgeTools } from "./knowledge-tools.ts";
import { liveConsoleEmitter } from "./live-console.ts";
import { memoryTools } from "./memory-tools.ts";
import { projectTools } from "./project-tools.ts";
import { shellTools } from "./shell-tools.ts";
import { skillTools } from "./skill-tools.ts";
import { getSession, updateSessionCwd } from "./store.ts";
import { taskTools } from "./task-tools.ts";
import type { ToolPermission, ToolPermissionStore } from "./tool-permissions.ts";
import type { StartTurn } from "./turn-start.ts";
import { workflowTools } from "./workflow-tools.ts";
import { sandboxOf } from "./working-directory.ts";

const log = createLogger("shell");

export interface TurnToolsDeps {
  db: KiriDb;
  /** Workspace config, read by the skill and workflow tools. */
  config: ConfigStore;
  /** The effective `kiri.yaml`, read at each auto-permission judgement for the utility model. */
  configService: ConfigService;
  /** Workflow registry backing the first-party workflow tools — read live. */
  registry: Registry;
  llmClients: LlmClients;
  bus?: EventBus;
  cancelRegistry?: CancelRegistry;
  /** MCP server registry; its discovered tools are read live on every assembly. */
  mcpRegistry?: McpRegistry;
  /** Standing per-tool permissions: an "off" tool is withheld, an "ask" tool is gated, an "allow" tool runs straight through. */
  toolPermissions: ToolPermissionStore;
  /** Live provider names for the workflow authoring tools' validation gate. */
  getProviderNames?: () => ReadonlySet<string>;
  /** The auto shell permission's learning loop: every judgement is recorded, and distilled precedent feeds the judge. */
  commandLearning: CommandLearning;
  /** Starts the turn of a worker the delegate tool spawns, as any session's turn starts. */
  startTurn: StartTurn;
}

/** Assembles the permission-gated tools a session's turn is offered. */
export interface TurnTools {
  /**
   * The tools offered to a turn of `sessionId` under `snapshot`. `writer` is
   * the owning turn's stream writer, so a tool can emit live progress while
   * it runs; without one (enumerating tool names for the system prompt) the
   * tools run without a live feed. Both constructions gate identically, so
   * the names always match.
   */
  activeTools(
    sessionId: string,
    snapshot: ConfigSnapshot,
    writer?: UIMessageStreamWriter,
    instructionContext?: InstructionContext,
  ): ToolSet;
}

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

/** Create the tool assembly a session surface shares between every driver of a turn. */
export function createTurnTools(deps: TurnToolsDeps): TurnTools {
  const {
    db,
    config,
    configService,
    registry,
    llmClients,
    bus,
    cancelRegistry,
    mcpRegistry,
    toolPermissions,
    getProviderNames,
    commandLearning,
    startTurn,
  } = deps;

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
    const model = configService.current().models.utility;
    if (model === undefined) return true;
    const screened = screenCommand(command);
    const decision =
      screened.verdict === "judge"
        ? await judgeCommand({
            llmClients,
            model,
            command: screened.command,
            cwd: cwd ?? sandboxOf(configService.current()).join(", "),
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
      cwd: cwd ?? sandboxOf(configService.current()).join(", "),
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
        status: session.status,
      });
    },
  });

  // `writer` is the owning turn's stream writer, threaded here — the one
  // tool-assembly point — so any tool can emit live progress parts while it
  // runs; today only run_command's live console does. Absent (a writer-less
  // construction, used to enumerate tool names for the system prompt), the
  // tools run without a live feed.
  const builtinToolsFor = (
    sessionId: string,
    sandbox: readonly string[],
    writer?: UIMessageStreamWriter,
    instructionContext?: InstructionContext,
  ): ToolSet => {
    return {
      ...skillTools(config),
      ...knowledgeTools({ db, registry }, getSession(db, sessionId)?.projectId ?? null),
      ...workflowTools({
        db,
        registry,
        config,
        bus,
        cancelRegistry,
        llmClients,
        getProviderNames,
        checkInstructions: (directory) =>
          instructionContext?.requireForDirectory(directory, { scope: "workflow" }),
      }),
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
      ...(sandbox.length > 0
        ? filesystemTools(() => sandbox, cwdBindingFor(sessionId), {
            checkInstructions: (directory, recursive) =>
              instructionContext?.requireForDirectory(directory, { recursive }),
          })
        : {}),
      ...(sandbox.length > 0
        ? shellTools(() => sandbox, cwdBindingFor(sessionId), {
            checkInstructions: (directory) => instructionContext?.requireForDirectory(directory),
            ...(writer === undefined
              ? {}
              : { liveConsole: (toolCallId: string) => liveConsoleEmitter(writer, toolCallId) }),
          })
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
  // instructions — which workers inherit — are the user's to change
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
  // A delegated child runs this same gated catalogue, minus the withheld set
  // above and with message_parent in place of the delegation tools. An
  // ask-gated call pauses the child like any session — surfaced on the
  // parent, resolved only by the user — so delegation still never widens
  // what runs unprompted.
  const activeTools = (
    sessionId: string,
    snapshot: ConfigSnapshot,
    writer?: UIMessageStreamWriter,
    instructionContext?: InstructionContext,
  ): ToolSet => {
    const isChild = getSession(db, sessionId)?.parentSessionId != null;
    const tools: ToolSet = {};
    for (const [name, mcpTool] of Object.entries(mcpRegistry?.tools() ?? {})) {
      const offered = gate(name, mcpTool, "ask");
      if (offered !== null) tools[name] = offered;
    }
    const builtin: ToolSet = {
      ...builtinToolsFor(sessionId, sandboxOf(snapshot), writer, instructionContext),
      // A worker can't spawn workers: the delegation tools (delegate and
      // message_worker) are offered only to a session with no parent, and
      // message_parent only to one with a parent to message. Delegate
      // models, when configured, make the worker's model a required role
      // choice, taken from the turn's snapshot so a kiri.yaml edit applies on
      // the next turn.
      ...(isChild
        ? messageParentTool({ db, childSessionId: sessionId, bus })
        : delegateTool({
            db,
            parentSessionId: sessionId,
            startTurn,
            bus,
            delegates: snapshot.models.delegates,
          })),
    };
    for (const { name, defaultPermission } of BUILTIN_TOOLS) {
      const builtinTool = builtin[name];
      if (builtinTool === undefined || (isChild && childWithheld.has(name))) continue;
      const offered = gate(name, builtinTool, defaultPermission);
      if (offered !== null) tools[name] = offered;
    }
    return tools;
  };

  return { activeTools };
}
