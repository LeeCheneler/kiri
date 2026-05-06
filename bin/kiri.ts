#!/usr/bin/env bun
import { app } from "../src/server/index.ts";

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`kiri listening on http://localhost:${server.port}`);
