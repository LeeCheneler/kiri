import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_INSTRUCTIONS_FILENAME,
  PERSONAS_DIRNAME,
  buildSystemPrompt,
  listPersonas,
  loadPersona,
} from "./system-prompt.ts";

const FIXED_NOW = new Date("2026-06-17T10:00:00.000Z");

// Write a persona file `personas/<name>.md` under `dir`, creating the dir.
function writePersona(dir: string, name: string, body: string): void {
  const personasDir = join(dir, PERSONAS_DIRNAME);
  mkdirSync(personasDir, { recursive: true });
  writeFileSync(join(personasDir, `${name}.md`), body);
}

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

  it("appends the attached persona after agent.md", () => {
    writeFileSync(join(dir, AGENT_INSTRUCTIONS_FILENAME), "Always answer in British English.");
    writePersona(dir, "code-reviewer", "You are a meticulous code reviewer.");

    const prompt = buildSystemPrompt({ cwd: dir, persona: "code-reviewer", now: FIXED_NOW });

    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Always answer in British English.");
    expect(prompt).toContain("You are a meticulous code reviewer.");
    // Composition order: core → agent.md → persona.
    expect(prompt.indexOf("running inside kiri")).toBeLessThan(
      prompt.indexOf("Always answer in British English."),
    );
    expect(prompt.indexOf("Always answer in British English.")).toBeLessThan(
      prompt.indexOf("You are a meticulous code reviewer."),
    );
  });

  it("overlays a persona even when agent.md is absent", () => {
    writePersona(dir, "poet", "You speak only in verse.");
    const prompt = buildSystemPrompt({ cwd: dir, persona: "poet", now: FIXED_NOW });
    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("You speak only in verse.");
  });

  it("ignores a persona that does not exist", () => {
    const withMissing = buildSystemPrompt({ cwd: dir, persona: "ghost", now: FIXED_NOW });
    const withNone = buildSystemPrompt({ cwd: dir, now: FIXED_NOW });
    expect(withMissing).toBe(withNone);
  });
});

describe("listPersonas", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-personas-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when there is no personas directory", () => {
    expect(listPersonas(dir)).toEqual([]);
  });

  it("lists the markdown persona names, sorted, ignoring non-markdown files", () => {
    writePersona(dir, "reviewer", "r");
    writePersona(dir, "architect", "a");
    writeFileSync(join(dir, PERSONAS_DIRNAME, "notes.txt"), "ignored");
    expect(listPersonas(dir)).toEqual(["architect", "reviewer"]);
  });
});

describe("loadPersona", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-personas-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a persona's trimmed instructions", () => {
    writePersona(dir, "reviewer", "  Review carefully.\n");
    expect(loadPersona(dir, "reviewer")).toBe("Review carefully.");
  });

  it("refuses a name that escapes the personas directory", () => {
    writeFileSync(join(dir, "secret.md"), "should never be read");
    // `../secret` would resolve outside personas/ — the guard returns null.
    expect(loadPersona(dir, "../secret")).toBeNull();
  });
});
