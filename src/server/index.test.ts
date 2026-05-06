import { describe, expect, it } from "bun:test";
import { app } from "./index.ts";

describe("hono app", () => {
  it("returns hello on GET /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello, kiri");
  });
});
