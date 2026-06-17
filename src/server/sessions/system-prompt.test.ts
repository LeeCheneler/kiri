import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_INSTRUCTIONS_FILENAME, buildSystemPrompt } from "./system-prompt.ts";

const FIXED_NOW = new Date("2026-06-17T10:00:00.000Z");

describe("buildSystemPrompt", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sysprompt-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("always includes the kiri core layer with the current date", () => {
    const prompt = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });
    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Today's date is 2026-06-17.");
  });

  it("documents the chart rendering capability with a worked example", () => {
    const prompt = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });
    // The fence keyword the markdown renderer routes to the chart component.
    expect(prompt).toContain("```chart");
    // The load-bearing constraints: Vega-Lite, inline data, no remote fetch.
    expect(prompt).toContain("Vega-Lite");
    expect(prompt).toContain("data.values");
    expect(prompt.toLowerCase()).toContain("remote data");
  });

  it("appends agent.md instructions after the core layer", () => {
    writeFileSync(join(dir, AGENT_INSTRUCTIONS_FILENAME), "Always answer in British English.\n");
    const prompt = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });

    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Always answer in British English.");
    // Core first, then the user's standing instructions.
    expect(prompt.indexOf("running inside kiri")).toBeLessThan(
      prompt.indexOf("Always answer in British English."),
    );
  });

  it("returns just the core layer when agent.md is absent", () => {
    const withFile = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });
    expect(withFile).toContain("running inside kiri");
    expect(withFile).not.toContain("Always answer");
  });

  it("ignores an empty or whitespace-only agent.md", () => {
    writeFileSync(join(dir, AGENT_INSTRUCTIONS_FILENAME), "   \n\t\n");
    const withWhitespace = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });
    // Identical to the no-file result: no trailing separator, no empty section.
    const withoutFile = buildSystemPrompt({ cwd: join(dir, "absent"), now: FIXED_NOW });
    expect(withWhitespace).toBe(withoutFile);
  });
});
