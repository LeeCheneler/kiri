#!/usr/bin/env bun
import { join } from "node:path";
import { bootstrap } from "../src/server/bootstrap.ts";
import { app } from "../src/server/index.ts";
import {
  type WorkflowWatcher,
  createRegistry,
  loadWorkflows,
  watchWorkflows,
} from "../src/server/workflows/index.ts";

const cwd = process.cwd();
const db = bootstrap(cwd);
const registry = createRegistry();

const workflowsDir = join(cwd, "workflows");
const initial = await loadWorkflows(workflowsDir);
registry.replace(initial.workflows);

let watcher: WorkflowWatcher | undefined;
if (process.env.NODE_ENV !== "production") {
  watcher = watchWorkflows(workflowsDir, registry, initial);
}

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
