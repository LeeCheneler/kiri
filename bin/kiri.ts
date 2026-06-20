#!/usr/bin/env bun
import { bootstrap } from "../src/server/bootstrap.ts";
import { resolveConfigDir } from "../src/server/config-dir.ts";
import { loadWorkspaceEnv } from "../src/server/config/env.ts";
import { loadKiriConfig } from "../src/server/config/loader.ts";
import { createConfigStore } from "../src/server/config/store.ts";
import { createEventBus } from "../src/server/events/index.ts";
import { createApp } from "../src/server/index.ts";
import { initRepo } from "../src/server/init.ts";
import { startServer } from "../src/server/listen.ts";
import { createLlmClients, createLlmProviderRegistry } from "../src/server/llm/index.ts";
import { createCancelRegistry } from "../src/server/runner/cancel-registry.ts";
import { createSessionTools } from "../src/server/sessions/index.ts";
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
if (kiriConfig.warning) {
  console.warn(`kiri.yaml: ${kiriConfig.warning}`);
}
if (kiriConfig.failure) {
  console.error(
    `kiri.yaml: failed to load ${kiriConfig.failure.path}: ${kiriConfig.failure.reason}`,
  );
}
const providerNames = new Set(kiriConfig.providers.keys());
const llmClients = createLlmClients(llmRegistry, process.env);
// Tools are offered to every session's model; each self-gates on its own
// precondition (web_search and web_extract on TAVILY_API_KEY), so an env
// without those keys yields an empty set and sessions run as plain chat.
const sessionTools = createSessionTools(process.env);

const initial = await loadWorkflows(config, providerNames);
registry.replace(initial.workflows);
for (const failure of initial.failures) {
  console.error(`workflows: failed to load ${failure.path}: ${failure.reason}`);
}

const watcher = watchWorkflows(config, registry, initial, { bus, providerNames });

const app = createApp({
  db,
  registry,
  config,
  bus,
  cancelRegistry,
  llmClients,
  sessionTools,
  version: VERSION,
});
const server = startServer({ app, port: 4242 });
console.log("Visit https://local.kiri.build");

const shutdown = () => {
  watcher.stop();
  server.stop();
  db.$client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
