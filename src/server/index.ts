import { Hono } from "hono";
import { serveStatic } from "hono/bun";

/**
 * Hono app serving the kiri HTTP API and the built SPA bundle. The same
 * process runs the orchestrator and serves the UI — one origin, one
 * lifetime.
 */
export const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/todos", (c) => c.json(["Buy milk", "Walk dog", "Write tests"]));
app.use("*", serveStatic({ root: "./dist/client" }));
