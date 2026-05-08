#!/usr/bin/env bun
import { join } from "node:path";
import { bootstrap } from "../src/server/bootstrap.ts";
import { createApp } from "../src/server/index.ts";
import { initRepo } from "../src/server/init.ts";
import {
  type WorkflowWatcher,
  createRegistry,
  loadWorkflows,
  watchWorkflows,
} from "../src/server/workflows/index.ts";

const HELP = `Usage: kiri [command]

Commands:
  init           Scaffold workflow authoring assets in the current directory

Run kiri with no command to start the server.

Options:
  -h, --help     Show this help text
`;

const INIT_HELP = `Usage: kiri init

Scaffold workflow authoring assets in the current directory:
  README.md                   DSL reference and IDE/LSP setup notes
  workflows/example.yaml      Minimal example workflow
  scripts/example/hello.sh    Paired example script (executable)
  .kiri/workflow.schema.json  JSON Schema for editor validation

Existing files are never overwritten; only missing files are created.
The schema file is always (re)written from the live Zod schema, so a
plain \`kiri\` launch also keeps it in sync after a binary upgrade.
`;

const args = process.argv.slice(2);
const cwd = process.cwd();

if (args[0] === "--help" || args[0] === "-h") {
  console.log(HELP);
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

const workflowsDir = join(cwd, "workflows");
const initial = await loadWorkflows(workflowsDir, cwd);
registry.replace(initial.workflows);
for (const failure of initial.failures) {
  console.error(`workflows: failed to load ${failure.path}: ${failure.reason}`);
}

let watcher: WorkflowWatcher | undefined;
if (process.env.NODE_ENV !== "production") {
  watcher = watchWorkflows(workflowsDir, cwd, registry, initial);
}

const app = createApp({ db, registry, cwd });
const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`kiri listening on http://localhost:${server.port}`);

const shutdown = () => {
  watcher?.stop();
  server.stop();
  db.$client.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
