import { Hono } from "hono";
import { serveStatic } from "hono/bun";

export const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/todos", (c) => c.json(["Buy milk", "Walk dog", "Write tests"]));
app.use("*", serveStatic({ root: "./dist/client" }));
