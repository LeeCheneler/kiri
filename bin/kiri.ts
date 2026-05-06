#!/usr/bin/env bun
import { bootstrap } from "../src/server/bootstrap.ts";
import { app } from "../src/server/index.ts";

bootstrap(process.cwd());

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`kiri listening on http://localhost:${server.port}`);
