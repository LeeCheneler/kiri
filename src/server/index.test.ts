import { describe, expect, it } from "bun:test";
import { app } from "./index.ts";

describe("hono app", () => {
  it("returns ok on GET /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns todos on GET /api/todos", async () => {
    const res = await app.request("/api/todos");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["Buy milk", "Walk dog", "Write tests"]);
  });
});
