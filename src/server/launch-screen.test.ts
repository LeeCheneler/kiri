import { beforeEach, describe, expect, it } from "bun:test";
import type { ConfigHealth } from "./config/health.ts";
import { displayPath, renderHeader, renderHealth, renderReady } from "./launch-screen.ts";
import { setColorEnabled, stripAnsi } from "./log.ts";

const facts = {
  workspace: "/tmp/ws",
  url: "https://local.kiri.build",
  envLoaded: 0,
  envFile: "/tmp/ws/.env",
  providers: [],
  mcp: { connected: 0, total: 0 },
  workflows: 3,
  health: { checks: [] } as unknown as ConfigHealth,
};

describe("displayPath", () => {
  it("collapses the home directory to ~ and leaves other paths alone", () => {
    expect(displayPath("/home/lee/ws", "/home/lee")).toBe("~/ws");
    expect(displayPath("/home/lee", "/home/lee")).toBe("~");
    expect(displayPath("/home/leeann/ws", "/home/lee")).toBe("/home/leeann/ws");
    expect(displayPath("/tmp/ws", "/home/lee")).toBe("/tmp/ws");
    expect(typeof displayPath("/x")).toBe("string");
  });
});

describe("launch screen", () => {
  beforeEach(() => setColorEnabled(false));

  it("renders the header with the version and tagline", () => {
    const text = renderHeader("v1.2.3").join("\n");
    expect(text).toContain("kiri v1.2.3");
    expect(text).toContain("writes things down");
  });

  it("renders nothing when every check is ok", () => {
    expect(renderHealth({ checks: [] } as unknown as ConfigHealth)).toEqual([]);
    expect(
      renderHealth({
        checks: [{ area: "config", level: "ok", title: "t", detail: "d" }],
      } as unknown as ConfigHealth),
    ).toEqual([]);
  });

  it("renders one marked row per check needing attention, skipping ok ones", () => {
    const health = {
      checks: [
        { area: "providers", level: "ok", title: "openai", detail: "key present" },
        { area: "mcp", level: "degraded", title: "linear", detail: "needs sign-in" },
        { area: "config", level: "error", title: "kiri.yaml", detail: "invalid" },
      ],
    } as unknown as ConfigHealth;
    const text = renderHealth(health).join("\n");
    expect(text).toContain("config health");
    expect(text).not.toContain("openai");
    expect(text).toContain("● degraded linear — needs sign-in");
    expect(text).toContain("● error    kiri.yaml — invalid");
  });

  it("tints the health frame by the worst level", () => {
    setColorEnabled(true);
    const only = (level: string) =>
      renderHealth({
        checks: [{ area: "config", level, title: "t", detail: "d" }],
      } as unknown as ConfigHealth)[0];
    expect(only("degraded")).toContain("\x1b[33m");
    expect(only("error")).toContain("\x1b[31m");
  });

  it("summarises an empty workspace with dimmed placeholders", () => {
    const text = stripAnsi(renderReady(facts).join("\n"));
    expect(text).toContain("workspace  /tmp/ws");
    expect(text).toContain("env        no .env loaded");
    expect(text).toContain("providers  none");
    expect(text).toContain("mcp        none");
    expect(text).toContain("workflows  3 loaded");
    expect(text).toContain("health     ok");
    expect(text).toContain("➜  https://local.kiri.build");
  });

  it("summarises a populated workspace", () => {
    const text = stripAnsi(
      renderReady({
        ...facts,
        envLoaded: 2,
        providers: ["openai", "anthropic"],
        mcp: { connected: 1, total: 2 },
        health: {
          checks: [
            { area: "config", level: "ok", title: "t", detail: "d" },
            { area: "mcp", level: "degraded", title: "t", detail: "d" },
          ],
        } as unknown as ConfigHealth,
      }).join("\n"),
    );
    expect(text).toContain("health     1 check(s) need attention");
    expect(text).toContain("env        2 variable(s) from /tmp/ws/.env");
    expect(text).toContain("providers  openai, anthropic");
    expect(text).toContain("mcp        1/2 connected");
  });
});
