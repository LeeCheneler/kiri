import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import {
  INSTRUCTIONS_FILENAME,
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
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sysprompt-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("always includes the kiri core layer with the current date", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Today's date is 2026-06-17.");
  });

  it("documents KaTeX maths rendering and its maths-only boundary", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // Maths renders via KaTeX, so the prompt must show how to invoke it
    // (`$…$` / `$$…$$`) and where it stops: maths-only, no document-level
    // LaTeX, no raw HTML.
    expect(prompt).toContain("KaTeX");
    expect(prompt).toContain("$$");
    expect(prompt).toContain("maths-only");
    expect(prompt.toLowerCase()).toContain("does not render");
    expect(prompt.toLowerCase()).toContain("no support for raw html");
  });

  it("documents the chart rendering capability with a worked example", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // The fence keyword the markdown renderer routes to the chart component.
    expect(prompt).toContain("```chart");
    // The load-bearing constraints: Vega-Lite, inline data, no remote fetch.
    expect(prompt).toContain("Vega-Lite");
    expect(prompt).toContain("data.values");
    expect(prompt.toLowerCase()).toContain("remote data");
  });

  it("tells the model when not to render a chart", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("only when a visualisation genuinely helps");
    expect(prompt).toContain("don't chart");
  });

  it("documents the mermaid diagram rendering capability with a worked example", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // The fence keyword the markdown renderer routes to the diagram component.
    expect(prompt).toContain("```mermaid");
    // The when-to-use distinction from charts: structure, not quantities.
    expect(prompt).toContain("structure or relationships");
    expect(prompt).toContain("a diagram when the point is the structure");
  });

  it("omits tool guidance when no tools are active", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).not.toContain("You have tools available");
  });

  it("gives generic tool guidance, before the chart guidance, when any tool is active", () => {
    const prompt = buildSystemPrompt({ config, tools: ["linear__create_issue"], now: FIXED_NOW });
    expect(prompt).toContain("You have tools available");
    // Tool guidance lives in the core layer, ahead of the chart guidance.
    expect(prompt.indexOf("You have tools available")).toBeLessThan(prompt.indexOf("```chart"));
  });

  it("appends kiri.md instructions after the core layer", () => {
    writeFileSync(join(dir, INSTRUCTIONS_FILENAME), "Always answer in British English.\n");
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });

    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Always answer in British English.");
    // Core first, then the user's standing instructions.
    expect(prompt.indexOf("running inside kiri")).toBeLessThan(
      prompt.indexOf("Always answer in British English."),
    );
  });

  it("treats an unreadable kiri.md as absent", () => {
    // A directory at the kiri.md path makes readFileSync throw (EISDIR); the
    // read-error path degrades to "no instructions" rather than failing.
    mkdirSync(join(dir, INSTRUCTIONS_FILENAME));
    const withUnreadable = buildSystemPrompt({ config, now: FIXED_NOW });
    const withNone = buildSystemPrompt({
      config: createConfigStore(join(dir, "absent")),
      now: FIXED_NOW,
    });
    expect(withUnreadable).toBe(withNone);
  });

  it("returns just the core layer when kiri.md is absent", () => {
    const withFile = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(withFile).toContain("running inside kiri");
    expect(withFile).not.toContain("Always answer");
  });

  it("ignores an empty or whitespace-only kiri.md", () => {
    writeFileSync(join(dir, INSTRUCTIONS_FILENAME), "   \n\t\n");
    const withWhitespace = buildSystemPrompt({ config, now: FIXED_NOW });
    // Identical to the no-file result: no trailing separator, no empty section.
    const withoutFile = buildSystemPrompt({
      config: createConfigStore(join(dir, "absent")),
      now: FIXED_NOW,
    });
    expect(withWhitespace).toBe(withoutFile);
  });

  it("appends the attached persona after kiri.md", () => {
    writeFileSync(join(dir, INSTRUCTIONS_FILENAME), "Always answer in British English.");
    writePersona(dir, "code-reviewer", "You are a meticulous code reviewer.");

    const prompt = buildSystemPrompt({ config, persona: "code-reviewer", now: FIXED_NOW });

    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("Always answer in British English.");
    expect(prompt).toContain("You are a meticulous code reviewer.");
    // Composition order: core → kiri.md → persona.
    expect(prompt.indexOf("running inside kiri")).toBeLessThan(
      prompt.indexOf("Always answer in British English."),
    );
    expect(prompt.indexOf("Always answer in British English.")).toBeLessThan(
      prompt.indexOf("You are a meticulous code reviewer."),
    );
  });

  it("overlays a persona even when kiri.md is absent", () => {
    writePersona(dir, "poet", "You speak only in verse.");
    const prompt = buildSystemPrompt({ config, persona: "poet", now: FIXED_NOW });
    expect(prompt).toContain("running inside kiri");
    expect(prompt).toContain("You speak only in verse.");
  });

  it("ignores a persona that does not exist", () => {
    const withMissing = buildSystemPrompt({ config, persona: "ghost", now: FIXED_NOW });
    const withNone = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(withMissing).toBe(withNone);
  });
});

describe("listPersonas", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-personas-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when there is no personas directory", () => {
    expect(listPersonas(config)).toEqual([]);
  });

  it("lists the markdown personas, sorted, with humanised names, ignoring non-markdown files", () => {
    writePersona(dir, "reviewer", "r");
    writePersona(dir, "architect", "a");
    writePersona(dir, "financial-advisor", "f");
    writeFileSync(join(dir, PERSONAS_DIRNAME, "notes.txt"), "ignored");
    expect(listPersonas(config)).toEqual([
      { id: "architect", name: "Architect" },
      { id: "financial-advisor", name: "Financial Advisor" },
      { id: "reviewer", name: "Reviewer" },
    ]);
  });
});

describe("loadPersona", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-personas-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a persona's trimmed instructions", () => {
    writePersona(dir, "reviewer", "  Review carefully.\n");
    expect(loadPersona(config, "reviewer")).toBe("Review carefully.");
  });

  it("refuses a name that escapes the personas directory", () => {
    writeFileSync(join(dir, "secret.md"), "should never be read");
    // `../secret` would resolve outside personas/ — the guard returns null.
    expect(loadPersona(config, "../secret")).toBeNull();
  });
});
