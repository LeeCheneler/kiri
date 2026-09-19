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
import { mountDelegationMessaging } from "./delegation-messaging.ts";
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
  /** The auto shell permission's learning loop: judgements and user verdicts in, distilled precedent out. */
  commandLearning: CommandLearning;
  /** Start a session's turn (see `createTurnStarter`). */
  startTurn: StartTurn;
  /** Abort the session's executing turn, which settles as `cancelled`. False when none is executing. */
  cancelTurn(sessionId: string): boolean;
  /**
   * Run a call nothing waits on, such as naming a session, holding the
   * application open until it settles. Not started once shutdown has begun.
   */
  background(name: string, task: () => Promise<unknown>): void;
}

/**
 * Compose the session runtime: the turn lifecycle, tool assembly and turn
 * preparation every driver shares, over one stream registry and one learning
 * loop. It also mounts the delegation messaging loop, which lives as long as
 * the runtime does: at shutdown the turns are drained first, so a cancelled
 * worker still leaves its notice for its parent, and the loop is unmounted
 * after them.
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

  // The tool assembly and the turn start need each other — the delegate tool
  // starts the workers it spawns — so the assembly reaches it lazily.
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
  });
  const preparation = createTurnPreparation({
    db,
    config,
    configService,
    llmClients,
    bus,
    turnTools,
  });

  const lifecycle = createTurnLifecycle({ db, bus, streamRegistry });
  const startTurn = createTurnStarter({
    db,
    llmClients,
    lifecycle,
    prepareTurn: preparation.prepareTurn,
  });

  const unmountMessaging = mountDelegationMessaging({ db, bus, startTurn });

  const lifetime = deps.lifetime ?? createAppLifetime();
  lifetime.own("session turns", async () => {
    commandLearning.stop();
    await lifecycle.drain();
    unmountMessaging();
  });

  return {
    streamRegistry,
    commandLearning,
    startTurn,
    cancelTurn: lifecycle.cancel,
    background(name, task) {
      if (!lifetime.closing.aborted) lifetime.track(name, task());
    },
  };
}
