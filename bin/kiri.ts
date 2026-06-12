#!/usr/bin/env bun
import { join } from "node:path";
import { bootstrap } from "../src/server/bootstrap.ts";
import { resolveConfigDir } from "../src/server/config-dir.ts";
import { createEventBus } from "../src/server/events/index.ts";
import { createApp } from "../src/server/index.ts";
import { initRepo } from "../src/server/init.ts";
import { startServer } from "../src/server/listen.ts";
import { createCancelRegistry } from "../src/server/runner/cancel-registry.ts";
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
  README.md                   Workflow DSL reference and IDE/LSP setup notes
  workflows/hello-world.yaml  Minimal one-step starter workflow
  .kiri/workflow.schema.json  JSON Schema for editor validation

The working directory is the current directory, or KIRI_CONFIG_DIR if set.
Existing files are never overwritten; only missing files are created.
The schema file is always (re)written from the live Zod schema, so a
plain \`kiri\` launch also keeps it in sync after a binary upgrade.
`;

const args = process.argv.slice(2);
const cwd = resolveConfigDir(process.env, process.cwd());

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
  const result = initRepo(cwd);
  for (const path of result.created) console.log(`created  ${path}`);
  for (const path of result.skipped) console.log(`skipped  ${path} (already exists)`);
  console.log(`schema   ${result.schemaPath}`);
  if (result.gitignoreUpdated) console.log("updated  .gitignore (added .kiri/)");
  process.exit(0);
}

if (args.length > 0) {
  console.error(`kiri: unknown command "${args[0]}"\n`);
  console.error(HELP);
  process.exit(1);
}

const db = bootstrap(cwd);
const registry = createRegistry();
const bus = createEventBus();
const cancelRegistry = createCancelRegistry();

const workflowsDir = join(cwd, "workflows");
const initial = await loadWorkflows(workflowsDir, cwd);
registry.replace(initial.workflows);
for (const failure of initial.failures) {
  console.error(`workflows: failed to load ${failure.path}: ${failure.reason}`);
}

const watcher = watchWorkflows(workflowsDir, cwd, registry, initial, { bus });

const app = createApp({ db, registry, cwd, bus, cancelRegistry, version: VERSION });
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
