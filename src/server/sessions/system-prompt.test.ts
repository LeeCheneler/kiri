import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import type { Session } from "./store.ts";
import {
  INSTRUCTIONS_FILENAME,
  PERSONAS_DIRNAME,
  buildChildSessionPrompt,
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

  it("names the host machine and targets shell output at its platform", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      host: { platform: "darwin", release: "25.5.0", arch: "arm64" },
    });
    // Shell commands and scripts run on the user's actual machine, so the
    // prompt must pin the platform — otherwise the model defaults to
    // generic-Linux idioms that fail on a BSD userland.
    expect(prompt).toContain("macOS (Darwin 25.5.0, arm64; BSD userland, not GNU)");
    expect(prompt).toContain("not for a generic Linux box");
  });

  it("detects the running machine when no host is injected", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("That machine is ");
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

  it("singles out raw/full-content options as the biggest token sink to keep off", () => {
    const prompt = buildSystemPrompt({ config, tools: ["tavily__extract"], now: FIXED_NOW });
    // The most common blow-up: requesting raw/full page content by default. The
    // guidance must call it the largest sink and tell the model to keep it off
    // until a cheaper result proves it's needed.
    expect(prompt.toLowerCase()).toContain("full-content");
    expect(prompt.toLowerCase()).toContain("raw");
    expect(prompt).toContain("Keep them off");
  });

  it("includes article guidance only when the article tools are active", () => {
    const withArticles = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["create_article", "edit_article", "list_articles"],
    });
    expect(withArticles).toContain("You can save articles");
    // The guidance references the fenced chart/mermaid blocks, so it reads
    // after the sections that describe them.
    expect(withArticles.indexOf("```mermaid")).toBeLessThan(
      withArticles.indexOf("You can save articles"),
    );

    const mcpOnly = buildSystemPrompt({ config, now: FIXED_NOW, tools: ["linear__create_issue"] });
    expect(mcpOnly).not.toContain("You can save articles");
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain("You can save articles");
  });

  it("steers article changes to a targeted edit over a wholesale replace", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW, tools: ["create_article"] });
    expect(prompt).toContain("prefer a targeted edit_article call");
    expect(prompt).toContain("replace_article only when most of the body is changing");
  });

  it("includes workflow guidance only when run_workflow is active", () => {
    const withWorkflows = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["list_workflows", "run_workflow"],
    });
    expect(withWorkflows).toContain("You can run the user's workflows");
    expect(withWorkflows).toContain("call list_workflows to check the exact name");

    // list_workflows alone (run_workflow withheld by its permission) carries
    // no run guidance — the list tool's own description suffices.
    const listOnly = buildSystemPrompt({ config, now: FIXED_NOW, tools: ["list_workflows"] });
    expect(listOnly).not.toContain("You can run the user's workflows");
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain(
      "You can run the user's workflows",
    );
  });

  it("adds the rerun line to workflow guidance only when rerun_workflow is active", () => {
    const withRerun = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["list_workflows", "run_workflow", "rerun_workflow"],
    });
    expect(withRerun).toContain("go through rerun_workflow with the earlier run_id");

    // rerun_workflow withheld by its permission drops the line, not the
    // whole workflow-guidance layer.
    const withoutRerun = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["list_workflows", "run_workflow"],
    });
    expect(withoutRerun).toContain("You can run the user's workflows");
    expect(withoutRerun).not.toContain("go through rerun_workflow");
  });

  it("includes filesystem guidance with the allowed directories only when read_file is active", () => {
    const withFilesystem = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["find_files", "read_file", "search_files"],
      allowedDirectories: ["/srv/notes", "/srv/projects"],
    });
    expect(withFilesystem).toContain("You can work with the user's files");
    // The sandbox is enumerated so the model needn't discover the reachable
    // roots through errors, and the absolute-path currency is stated.
    expect(withFilesystem).toContain("- /srv/notes");
    expect(withFilesystem).toContain("- /srv/projects");
    expect(withFilesystem).toContain("must be absolute");

    // find_files alone (read_file withheld by its permission) carries no
    // filesystem guidance — the find tool's own description suffices.
    const findOnly = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["find_files"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(findOnly).not.toContain("You can work with the user's files");
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain(
      "You can work with the user's files",
    );
  });

  it("keys the write half of filesystem guidance off the write tools", () => {
    // Reads without writes (the write tools off) carry no write contract.
    const readsOnly = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["find_files", "read_file", "search_files"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(readsOnly).not.toContain("write_file");
    expect(readsOnly).not.toContain("Read before you change");

    // The full set carries every half: reads, writes, and directory/delete
    // management.
    const readsAndWrites = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: [
        "find_files",
        "read_file",
        "search_files",
        "write_file",
        "edit_file",
        "create_directory",
        "delete_file",
        "delete_directory",
      ],
      allowedDirectories: ["/srv/notes"],
    });
    expect(readsAndWrites).toContain("read_file reads one file");
    expect(readsAndWrites).toContain("write_file writes a whole file");
    expect(readsAndWrites).toContain("create_directory makes a directory");
    expect(readsAndWrites).toContain("Read before you change");

    // Writes with read_file off still get the sandbox contract and the write
    // bullets — just not the read-scoping advice.
    const writesOnly = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["write_file", "edit_file"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(writesOnly).toContain("You can work with the user's files");
    expect(writesOnly).toContain("- /srv/notes");
    expect(writesOnly).toContain("Read before you change");
    expect(writesOnly).not.toContain("Scope narrowly");
  });

  it("includes shell guidance with the working directories only when run_command is active", () => {
    const withShell = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["run_command"],
      shellDirectories: ["/srv/projects/app", "/srv/projects/lib"],
    });
    expect(withShell).toContain("You can run shell commands");
    // The working directories are enumerated so the model needn't discover
    // them through errors.
    expect(withShell).toContain("- /srv/projects/app");
    expect(withShell).toContain("- /srv/projects/lib");
    // The safety contract rides with the tool: the approval review is not the
    // model's safety margin, and the prohibitions are stated as hard rules.
    expect(withShell).toContain("not your safety margin");
    expect(withShell).toContain("Hard rules");
    expect(withShell).toContain("Never read or print secrets");
    expect(withShell).toContain("Never fetch-and-execute");

    // Without run_command (withheld by permission or configuration) none of
    // the shell guidance appears.
    const withoutShell = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_file"],
      allowedDirectories: ["/srv/notes"],
      shellDirectories: ["/srv/projects/app"],
    });
    expect(withoutShell).not.toContain("You can run shell commands");
    expect(withoutShell).not.toContain("Hard rules");
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain(
      "You can run shell commands",
    );
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

describe("delegate guidance", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sysprompt-delegate-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("steers research to the delegate tool only when it is offered", () => {
    const withDelegate = buildSystemPrompt({
      config,
      tools: ["delegate", "tavily__search"],
      now: FIXED_NOW,
    });
    expect(withDelegate).toContain("prefer the `delegate` tool");
    // It must also steer against re-running the delegated work — the leak the
    // tool exists to prevent.
    expect(withDelegate).toContain("do not re-run the searches it already made");
    // A session without delegate gets no delegation steer — direct search is
    // the only research path it has.
    const withoutDelegate = buildSystemPrompt({
      config,
      tools: ["tavily__search"],
      now: FIXED_NOW,
    });
    expect(withoutDelegate).not.toContain("prefer the `delegate` tool");
  });
});

describe("buildChildSessionPrompt", () => {
  it("frames the worker as a delegated sub-agent that reports back", () => {
    const prompt = buildChildSessionPrompt({ now: FIXED_NOW });
    expect(prompt).toContain("focused assistant");
    expect(prompt).toContain("cannot see the parent conversation");
    expect(prompt).toContain("Report back:");
    expect(prompt).toContain("Synthesise, don't dump");
    expect(prompt).toContain("2026-06-17");
    // The user's chat layers never apply to a delegated worker.
    expect(prompt).not.toContain("interactive chat session");
  });

  it("names the host machine so platform-specific output fits it", () => {
    const prompt = buildChildSessionPrompt({
      now: FIXED_NOW,
      host: { platform: "darwin", release: "25.5.0", arch: "arm64" },
    });
    expect(prompt).toContain("macOS (Darwin 25.5.0, arm64; BSD userland, not GNU)");
    expect(buildChildSessionPrompt({ now: FIXED_NOW })).toContain("You are running on ");
  });

  it("includes tool-use guidance only when tools are active", () => {
    const withTools = buildChildSessionPrompt({ tools: ["tavily__search"], now: FIXED_NOW });
    expect(withTools).toContain("You have tools available");
    expect(buildChildSessionPrompt({ now: FIXED_NOW })).not.toContain("You have tools available");
  });

  it("carries the capability guidance its tool set activates", () => {
    const prompt = buildChildSessionPrompt({
      tools: ["read_file", "run_command"],
      allowedDirectories: ["/workspace/notes"],
      shellDirectories: ["/workspace/project"],
      now: FIXED_NOW,
    });
    expect(prompt).toContain("You can work with the user's files");
    expect(prompt).toContain("/workspace/notes");
    expect(prompt).toContain("You can run shell commands with run_command");
    expect(prompt).toContain("/workspace/project");
    // Neither section appears when its tools are absent.
    const bare = buildChildSessionPrompt({ tools: ["tavily__search"], now: FIXED_NOW });
    expect(bare).not.toContain("You can work with the user's files");
    expect(bare).not.toContain("You can run shell commands");
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
  // `persona` — a non-null parent marks a child session.
  const sessionWith = (parentSessionId: string | null): Session =>
    ({ parentSessionId, persona: null }) as unknown as Session;

  it("composes the layered chat prompt for a top-level session", () => {
    writeFileSync(config.instructionsFile(), "Be terse.");
    const prompt = createSystemPromptBuilder(config, ["tavily__search"])(sessionWith(null));
    expect(prompt).toContain("interactive chat session");
    expect(prompt).toContain("Be terse.");
  });

  it("uses the worker prompt for a child session, ignoring kiri.md", () => {
    writeFileSync(config.instructionsFile(), "Be terse.");
    const prompt = createSystemPromptBuilder(config, ["tavily__search"])(sessionWith("parent"));
    expect(prompt).toContain("focused assistant");
    expect(prompt).toContain("You have tools available");
    expect(prompt).not.toContain("Be terse.");
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
