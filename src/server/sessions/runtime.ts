import type { ConfigService } from "../config/service.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import { type AppLifetime, createAppLifetime } from "../lifetime.ts";
import type { LlmClients } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import type { Registry } from "../workflows/index.ts";
import { type CommandLearning, createCommandLearning } from "./command-learning.ts";
import { type DelegationMessaging, createDelegationMessaging } from "./delegation-messaging.ts";
import { type StreamRegistry, createStreamRegistry } from "./stream-registry.ts";
import type { ToolPermissionStore } from "./tool-permissions.ts";
import { createTurnLifecycle } from "./turn-lifecycle.ts";
import { createTurnPreparation } from "./turn-preparation.ts";
import { type StartTurn, createTurnStarter } from "./turn-start.ts";
import { createTurnTools } from "./turn-tools.ts";

export interface SessionRuntimeDeps {
  db: KiriDb;
  /** Workspace config; the session system prompt reads `kiri.md` against it. */
  config: ConfigStore;
  /**
   * The workspace's effective `kiri.yaml`: the filesystem sandbox and default
   * working directory, and the models config. A turn takes one snapshot, so
   * the tools it is offered and the guidance describing them agree.
   */
  configService: ConfigService;
  /** Workflow registry backing the first-party workflow tools — read live, so a definition change is reflected on the next turn. */
  registry: Registry;
  llmClients: LlmClients;
  /** Carries every session event. A message queued to a session out of a turn wakes it over this bus, and a worker's settled turn notices its parent. */
  bus: EventBus;
  /** Reaches the workflow runs a session's tools start; a turn itself is cancelled through `cancelTurn`. */
  cancelRegistry?: CancelRegistry;
  /**
   * Registry of in-flight turn streams a reconnecting client rejoins.
   * Defaults to a fresh registry owned by this runtime; injectable for tests.
   */
  streamRegistry?: StreamRegistry;
  /**
   * MCP server registry. Its discovered tools are offered to each turn's
   * model, read live so a config reload is reflected on the next turn.
   * Omitted leaves sessions with the first-party tools alone.
   */
  mcpRegistry?: McpRegistry;
  /** Standing per-tool permissions: an "off" tool is withheld, an "ask" tool is gated, an "allow" tool runs straight through. */
  toolPermissions: ToolPermissionStore;
  /** Live provider names for the workflow authoring tools' validation gate. */
  getProviderNames?: () => ReadonlySet<string>;
  /**
   * The auto shell permission's learning loop. Defaults to a file-backed
   * instance under `.kiri`; injectable for tests.
   */
  commandLearning?: CommandLearning;
  /**
   * The application's lifetime, which every turn and background call belongs
   * to. Defaults to one nothing shuts down.
   */
  lifetime?: AppLifetime;
}

/** What runs a session's turns, shared by every driver: HTTP, a worker spawn, a wake. */
export interface SessionRuntime {
  /** In-flight turn streams: a running turn fills it, a reconnecting client reads it. */
  streamRegistry: StreamRegistry;
  /** Start a session's turn (see `createTurnStarter`). */
  startTurn: StartTurn;
  /** Abort the session's executing turn, which settles as `cancelled`. False when none is executing. */
  cancelTurn(sessionId: string): boolean;
  /** Queue a message for a session and deliver it as the session's state allows. */
  sendMessage: DelegationMessaging["send"];
  /**
   * Run a call nothing waits on, such as naming a session, holding the
   * application open until it settles. Not started once shutdown has begun.
   */
  background(name: string, task: () => Promise<unknown>): void;
}

/**
 * Compose the session runtime: the turn lifecycle, tool assembly and turn
 * preparation and delegation messaging every driver shares, over one stream
 * registry and one learning loop. Sessions a stopped app left holding a backlog
 * are woken as it is built. At shutdown the turns are drained, so a cancelled
 * worker still leaves its notice for its parent; the wake that notice asks for
 * is refused like any other start.
 */
export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
  const { db, config, configService, llmClients, bus, cancelRegistry } = deps;
  const streamRegistry = deps.streamRegistry ?? createStreamRegistry();
  const commandLearning =
    deps.commandLearning ??
    createCommandLearning({
      llmClients,
      getModel: () => configService.current().models.utility,
      logFile: config.commandJudgementsFile(),
      guidanceFile: config.commandGuidanceFile(),
    });

  // The tool assembly, the turn start and the messaging need each other — the
  // delegate tools start and message workers, a settled turn is followed up
  // with messages, and a message starts a turn — so each reaches the next lazily.
  const turnTools = createTurnTools({
    db,
    config,
    configService,
    registry: deps.registry,
    llmClients,
    bus,
    cancelRegistry,
    mcpRegistry: deps.mcpRegistry,
    toolPermissions: deps.toolPermissions,
    getProviderNames: deps.getProviderNames,
    commandLearning,
    startTurn: ((session, start) => startTurn(session, start)) as StartTurn,
    sendMessage: (sessionId, message) => messaging.send(sessionId, message),
  });
  const preparation = createTurnPreparation({
    db,
    config,
    configService,
    llmClients,
    bus,
    turnTools,
  });

  const lifecycle = createTurnLifecycle({
    db,
    bus,
    streamRegistry,
    onSettled: (sessionId, settlement) => messaging.turnSettled(sessionId, settlement),
  });
  const startTurn = createTurnStarter({
    db,
    llmClients,
    lifecycle,
    prepareTurn: preparation.prepareTurn,
    // Every answered run_command is precedent for the learning loop, under
    // "ask" as much as "auto".
    onApprovalsResolved: (resolved) => {
      for (const { toolCallId, toolName, input, approved } of resolved) {
        if (toolName !== "run_command") continue;
        const command = (input as { command?: string } | undefined)?.command ?? "";
        commandLearning.recordResolution({ toolCallId, command, approved });
      }
    },
  });

  const messaging = createDelegationMessaging({ db, bus, startTurn });
  messaging.recover();

  const lifetime = deps.lifetime ?? createAppLifetime();
  lifetime.own("session turns", async () => {
    commandLearning.stop();
    await lifecycle.drain();
  });

  return {
    streamRegistry,
    startTurn,
    cancelTurn: lifecycle.cancel,
    sendMessage: messaging.send,
    background(name, task) {
      if (!lifetime.closing.aborted) lifetime.track(name, task());
    },
  };
}
