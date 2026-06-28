import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import type { Session } from "./store.ts";
import {
  INSTRUCTIONS_FILENAME,
  PERSONAS_DIRNAME,
  buildInvestigatorPrompt,
  buildSystemPrompt,
  createSystemPromptBuilder,
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

  it("states a knowledge cutoff so the model flags answers it can't verify", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("knowledge cutoff");
  });

  it("tells the model an unfamiliar reference is likely newer than its training, not a user mistake", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // The cutoff guidance must defuse the "I don't know it, so it doesn't
    // exist" failure: treat the unrecognised thing as real and newer, and
    // never assert nonexistence from memory alone.
    expect(prompt).toContain("newer than your training");
    expect(prompt).toContain("not as a mistake on their part");
    expect(prompt).toContain("not evidence it doesn't exist");
  });

  it("requires verifying a factual point before correcting the user", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // The push-back bullet must gate correction on verification rather than
    // contradicting from stale memory.
    expect(prompt).toContain("verify before you correct");
    expect(prompt).toContain("contradicting from memory");
  });

  it("carries response guidance: lead with the answer and calibrate length", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("How to respond:");
    expect(prompt).toContain("Lead with the answer");
    expect(prompt).toContain("Match length and shape");
  });

  it("sets an honesty bar against fabrication, including chart data", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("never fabricate");
    // The fabrication guard explicitly reaches the numbers behind a chart.
    expect(prompt).toContain("the data behind a chart");
  });

  it("marks the prompt and standing instructions authoritative over quoted text", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    // The untrusted-data line draws the boundary both ways: trusted instruction
    // layers are authoritative, quoted external text is data.
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("authoritative");
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

  it("expands tool guidance with parallelism and truncation awareness", () => {
    const prompt = buildSystemPrompt({ config, tools: ["linear__create_issue"], now: FIXED_NOW });
    expect(prompt).toContain("fire independent calls together");
    // kiri caps and times out tool results, so the model must not treat a
    // cut-off result as complete.
    expect(prompt).toContain("truncated");
    expect(prompt).toContain("incomplete");
  });

  it("tells the model some tool results arrive as TOON, only when tools are active", () => {
    const withTools = buildSystemPrompt({
      config,
      tools: ["linear__create_issue"],
      now: FIXED_NOW,
    });
    expect(withTools).toContain("TOON");
    // A plain chat never sees a TOON-encoded result, so it isn't told about them.
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain("TOON");
  });

  it("presses for token-frugal, tightly scoped tool calls", () => {
    const prompt = buildSystemPrompt({ config, tools: ["linear__create_issue"], now: FIXED_NOW });
    // The guidance must motivate frugality — calls and their results spend a
    // finite token budget — and name the load-bearing lever: default to the
    // narrowest form of each call, with its parameters as the main cost control.
    expect(prompt).toContain("token");
    expect(prompt).toContain("narrowest form");
    expect(prompt.toLowerCase()).toContain("parameters");
  });

  it("steers research to the investigate tool only when it is offered", () => {
    const withInvestigate = buildSystemPrompt({
      config,
      tools: ["investigate", "tavily__search"],
      now: FIXED_NOW,
    });
    expect(withInvestigate).toContain("prefer the `investigate` tool");
    // A session without investigate gets no delegation steer — direct search is
    // the only research path it has.
    const withoutInvestigate = buildSystemPrompt({
      config,
      tools: ["tavily__search"],
      now: FIXED_NOW,
    });
    expect(withoutInvestigate).not.toContain("prefer the `investigate` tool");
  });

  it("singles out raw/full-content options as the biggest token sink to keep off", () => {
    const prompt = buildSystemPrompt({ config, tools: ["tavily__extract"], now: FIXED_NOW });
    // The most common blow-up: requesting raw/full page content by default. The
    // guidance must call it the largest sink and tell the model to keep it off
    // until a cheaper result proves it's needed.
    expect(prompt.toLowerCase()).toContain("full-content");
    expect(prompt.toLowerCase()).toContain("raw");
    expect(prompt).toContain("Keep them off");
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

describe("buildInvestigatorPrompt", () => {
  it("frames the worker as a delegated researcher that reports back", () => {
    const prompt = buildInvestigatorPrompt({ now: FIXED_NOW });
    expect(prompt).toContain("focused research assistant");
    expect(prompt).toContain("cannot see the parent conversation");
    expect(prompt).toContain("Report back:");
    expect(prompt).toContain("Synthesise, don't dump");
    expect(prompt).toContain("2026-06-17");
  });

  it("includes tool-use guidance only when tools are active", () => {
    const withTools = buildInvestigatorPrompt({ tools: ["tavily__search"], now: FIXED_NOW });
    expect(withTools).toContain("You have tools available");
    expect(buildInvestigatorPrompt({ now: FIXED_NOW })).not.toContain("You have tools available");
  });
});

describe("createSystemPromptBuilder", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sysprompt-builder-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A minimal session stand-in: the builder reads only `parentSessionId` and
  // `persona` — a non-null parent marks a child sub-session.
  const sessionWith = (parentSessionId: string | null): Session =>
    ({ parentSessionId, persona: null }) as unknown as Session;

  it("composes the layered chat prompt for a top-level session", () => {
    writeFileSync(config.instructionsFile(), "Be terse.");
    const prompt = createSystemPromptBuilder(config, ["tavily__search"])(sessionWith(null));
    expect(prompt).toContain("interactive chat session");
    expect(prompt).toContain("Be terse.");
  });

  it("uses the investigator prompt for a child sub-session, ignoring kiri.md", () => {
    writeFileSync(config.instructionsFile(), "Be terse.");
    const prompt = createSystemPromptBuilder(config, ["tavily__search"])(sessionWith("parent"));
    expect(prompt).toContain("focused research assistant");
    expect(prompt).toContain("You have tools available");
    expect(prompt).not.toContain("Be terse.");
  });
});
