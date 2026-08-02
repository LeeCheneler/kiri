#!/usr/bin/env bun
import { createMCPClient } from "@ai-sdk/mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { bootstrap } from "../src/server/bootstrap.ts";
import { resolveConfigDir } from "../src/server/config-dir.ts";
import { loadWorkspaceEnv } from "../src/server/config/env.ts";
import {
  type ConfigCheckLevel,
  type ConfigHealth,
  evaluateConfigHealth,
} from "../src/server/config/health.ts";
import { loadKiriConfig } from "../src/server/config/loader.ts";
import { createConfigStore } from "../src/server/config/store.ts";
import { watchKiriConfig } from "../src/server/config/watcher.ts";
import { createEventBus } from "../src/server/events/index.ts";
import { createApp } from "../src/server/index.ts";
import { initRepo } from "../src/server/init.ts";
import { startServer } from "../src/server/listen.ts";
import { createLlmClients, createLlmProviderRegistry } from "../src/server/llm/index.ts";
import { type CreateMcpClient, connectMcpServer } from "../src/server/mcp/connect.ts";
import { createMcpCredentialStore } from "../src/server/mcp/oauth-store.ts";
import { createMcpRegistry } from "../src/server/mcp/registry.ts";
import { createCancelRegistry } from "../src/server/runner/cancel-registry.ts";
import { runOutputCommand } from "../src/server/runner/outputs.ts";
import { runRecommendCommand } from "../src/server/runner/recommendations.ts";
import { createRegistry, loadWorkflows, watchWorkflows } from "../src/server/workflows/index.ts";

// Replaced at build time via `bun build --define`; falls back to "dev" for local runs.
declare const KIRI_VERSION: string;
const VERSION: string = typeof KIRI_VERSION === "string" ? KIRI_VERSION : "dev";

const HELP = `Usage: kiri [command]

Commands:
  init           Scaffold workflow authoring assets in the working directory

Run kiri with no command to start the server.

Options:
  -h, --help     Show this help text
  -v, --version  Show kiri version

Environment:
  KIRI_CONFIG_DIR  Workspace directory to use instead of the current
                   directory. A leading ~ is expanded to your home.
`;

const INIT_HELP = `Usage: kiri init

Scaffold workflow authoring assets in the working directory:
  README.md                        Workflow DSL reference and IDE/LSP setup notes
  workflows/hello-world.yaml       Minimal one-step starter workflow
  kiri.yaml                        Structured config (LLM providers, …) — commented
  .kiri/workflow.schema.json       JSON Schema for editor validation
  .kiri/kiri.schema.json           JSON Schema for kiri.yaml

The working directory is the current directory, or KIRI_CONFIG_DIR if set.
Existing files are never overwritten; only missing files are created.
The schema files are always (re)written from the live Zod schemas, so a
plain \`kiri\` launch also keeps them in sync after a binary upgrade.
`;

// Boot-time console stream per severity, so errors land on stderr.
const HEALTH_STREAM: Record<ConfigCheckLevel, (line: string) => void> = {
  ok: console.log,
  degraded: console.warn,
  error: console.error,
};

/** Print the configuration-health report at boot, one aligned line per check. */
function printConfigHealth(health: ConfigHealth): void {
  if (health.checks.length === 0) return;
  console.log("Config health:");
  for (const check of health.checks) {
    HEALTH_STREAM[check.level](`  ${check.level.padEnd(8)} ${check.title} — ${check.detail}`);
  }
}

const args = process.argv.slice(2);
const config = createConfigStore(resolveConfigDir(process.env, process.cwd()));

if (args[0] === "--help" || args[0] === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(VERSION);
  process.exit(0);
}

// Hidden plumbing behind the per-run PATH shims (`kiri-output`,
// `kiri-recommend`) — each appends one line to its step-scoped channel
// file. Not part of the public CLI surface, so they stay out of HELP.
if (args[0] === "__output") {
  const result = runOutputCommand(args.slice(1), process.env);
  if (result.error) console.error(result.error);
  process.exit(result.exitCode);
}
if (args[0] === "__recommend") {
  const result = runRecommendCommand(args.slice(1), process.env);
  if (result.error) console.error(result.error);
  process.exit(result.exitCode);
}

if (args[0] === "init") {
  if (args[1] === "--help" || args[1] === "-h") {
    console.log(INIT_HELP);
    process.exit(0);
  }
  const result = initRepo(config);
  for (const path of result.created) console.log(`created  ${path}`);
  for (const path of result.skipped) console.log(`skipped  ${path} (already exists)`);
  console.log(`schema   ${result.schemaPath}`);
  console.log(`schema   ${result.configSchemaPath}`);
  if (result.gitignoreUpdated) console.log("updated  .gitignore (added .kiri/)");
  process.exit(0);
}

if (args.length > 0) {
  console.error(`kiri: unknown command "${args[0]}"\n`);
  console.error(HELP);
  process.exit(1);
}

// Load the workspace's own .env before anything reads process.env, so a
// workspace pinned via KIRI_CONFIG_DIR resolves its `{ env: }` refs from there
// rather than from the directory kiri happened to be launched from.
const loadedEnv = loadWorkspaceEnv(config);
if (loadedEnv.length > 0) {
  console.log(`Loaded ${loadedEnv.length} variable(s) from ${config.envFile()}`);
}

const db = bootstrap(config);
const registry = createRegistry();
const llmRegistry = createLlmProviderRegistry();
const bus = createEventBus();
const cancelRegistry = createCancelRegistry();

// Providers load first: workflow validation needs the provider names to
// check `llm:` model prefixes against.
const kiriConfig = loadKiriConfig(config, process.env);
llmRegistry.replace(kiriConfig.providers);

// MCP servers connect at boot; their tools are offered to every session, merged
// with the built-in tools. A server that fails to connect is recorded in the
// registry's status and skipped — it never blocks boot. The third-party SDK's
// tool type is stricter than the AI SDK's `ToolSet`, so the client factory is
// cast at this single boundary.
// OAuth tokens for `auth: oauth` http servers live in a mode-0600 file in .kiri/,
// reached via the loopback origin below — the OAuth callback redirect is built
// from it, so it must match the port the server binds.
const mcpCredentialStore = createMcpCredentialStore(
  config.mcpCredentialsFile(),
  "http://127.0.0.1:4242",
);
const mcpRegistry = createMcpRegistry(
  (server, env) =>
    connectMcpServer(
      server,
      env,
      createMCPClient as unknown as CreateMcpClient,
      server.type === "http" && server.oauth
        ? mcpCredentialStore.providerFor(server.name)
        : undefined,
    ),
  // A tool call that finds its OAuth expired flips the server to needs-sign-in;
  // announce it like a config change so the app re-fetches status and shows the
  // Connect prompt without a reload.
  () => bus.publish({ type: "config.changed" }),
);
await mcpRegistry.replace(kiriConfig.mcp, process.env);
const mcpStatuses = mcpRegistry.status();
if (mcpStatuses.length > 0) {
  const connected = mcpStatuses.filter((s) => s.state === "connected").length;
  console.log(`mcp: connected ${connected}/${mcpStatuses.length} server(s)`);
  for (const status of mcpStatuses) {
    if (status.state === "failed") {
      console.error(`mcp: ${status.name} failed to connect: ${status.error}`);
    } else if (status.state === "needs-sign-in") {
      console.warn(`mcp: ${status.name} needs sign-in — connect it from the app`);
    }
  }
}

// Surface configuration health at boot — warn-and-continue, never blocking the
// server from starting. The same report is served at GET /api/config/health.
printConfigHealth(evaluateConfigHealth({ kiriConfig, env: process.env }));
// Provider names come live off the registry so a kiri.yaml reload re-validates
// workflows against the new set (see the config watcher below).
const getProviderNames = () => new Set(llmRegistry.listProviders().map((p) => p.name));
const llmClients = createLlmClients(llmRegistry, process.env);

const initial = await loadWorkflows(config, getProviderNames());
registry.replace(initial.workflows, initial.sources);
for (const failure of initial.failures) {
  console.error(`workflows: failed to load ${failure.path}: ${failure.reason}`);
}

const watcher = watchWorkflows(config, registry, initial, { bus, getProviderNames });
// Hot-reload kiri.yaml the way workflows already reload: swap the provider
// registry, then revalidate workflows so `llm:` steps re-check their provider.
const configWatcher = watchKiriConfig(config, llmRegistry, process.env, {
  onReload: () => watcher.revalidate(),
  bus,
  mcpRegistry,
});
const app = createApp({
  db,
  registry,
  config,
  bus,
  cancelRegistry,
  llmClients,
  mcpRegistry,
  mcpCredentialStore,
  mcpAuth: auth,
  version: VERSION,
  env: process.env,
  getProviderNames,
});
const server = startServer({ app, port: 4242 });
console.log("Visit https://local.kiri.build");

const shutdown = async () => {
  // Stop the config watcher first so it can't schedule a revalidate after the
  // workflow watcher is torn down.
  configWatcher.stop();
  watcher.stop();
  server.stop();
  // Close MCP connections so spawned stdio subprocesses are terminated cleanly.
  await mcpRegistry.close();
  db.$client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
