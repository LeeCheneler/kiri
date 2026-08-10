import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import type { Session } from "./store.ts";
import {
  AGENTS_FILENAME,
  INSTRUCTIONS_FILENAME,
  buildChildSessionPrompt,
  buildSystemPrompt,
  createSystemPromptBuilder,
  readAgentsChain,
} from "./system-prompt.ts";

const FIXED_NOW = new Date("2026-06-17T10:00:00.000Z");

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

  it("states the session's effort level, defaulting to medium", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).toContain("This session's effort level is set to medium");
    expect(prompt).toContain("Apply ordinary care");
  });

  it("calibrates the effort expectation to the stated level", () => {
    const low = buildSystemPrompt({ config, effort: "low", now: FIXED_NOW });
    expect(low).toContain("This session's effort level is set to low");
    expect(low).toContain("Be brisk and direct");

    const high = buildSystemPrompt({ config, effort: "high", now: FIXED_NOW });
    expect(high).toContain("This session's effort level is set to high");
    expect(high).toContain("Work deliberately");

    const xhigh = buildSystemPrompt({ config, effort: "xhigh", now: FIXED_NOW });
    expect(xhigh).toContain("This session's effort level is set to xhigh");
    expect(xhigh).toContain("Prioritise result quality over time and cost");

    const max = buildSystemPrompt({ config, effort: "max", now: FIXED_NOW });
    expect(max).toContain("This session's effort level is set to max");
    expect(max).toContain("Be exhaustively thorough");
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

  it("lists skills by name and description only when use_skill is active", () => {
    const skills = [
      { name: "release-notes", description: "Draft release notes." },
      { name: "workflow-authoring", description: "Author kiri workflows." },
    ];
    const withSkills = buildSystemPrompt({ config, now: FIXED_NOW, tools: ["use_skill"], skills });
    expect(withSkills).toContain("loaded on demand with the use_skill tool");
    expect(withSkills).toContain("- release-notes: Draft release notes.");
    expect(withSkills).toContain("- workflow-authoring: Author kiri workflows.");

    // use_skill withheld by its permission drops the catalogue with it.
    const withoutTool = buildSystemPrompt({ config, now: FIXED_NOW, tools: [], skills });
    expect(withoutTool).not.toContain("use_skill");
  });

  it("omits the skill catalogue when no skills are discovered", () => {
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW, tools: ["use_skill"], skills: [] });
    expect(prompt).not.toContain("Available skills:");
  });

  it("indexes memories by name and summary only when read_memory is active", () => {
    const memories = [
      { name: "prefers-bun", description: "Prefers bun over node.", updatedAt: FIXED_NOW },
      {
        name: "release-style",
        description: "Groups release notes by feature.",
        updatedAt: FIXED_NOW,
      },
    ];
    const withMemories = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory", "save_memory", "delete_memory"],
      memories,
    });
    expect(withMemories).toContain("load its full body with read_memory");
    expect(withMemories).toContain("- prefers-bun: Prefers bun over node.");
    expect(withMemories).toContain("- release-style: Groups release notes by feature.");

    // read_memory withheld by its permission drops the index with it.
    const withoutTool = buildSystemPrompt({ config, now: FIXED_NOW, tools: [], memories });
    expect(withoutTool).not.toContain(
      "Saved memories, carried by every session in this workspace:",
    );
  });

  it("carries the saving discipline only when save_memory is active", () => {
    const memories = [
      { name: "prefers-bun", description: "Prefers bun over node.", updatedAt: FIXED_NOW },
    ];
    const readOnly = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory"],
      memories,
    });
    expect(readOnly).toContain("Saved memories, carried by every session in this workspace:");
    expect(readOnly).not.toContain("Saving memories:");

    const writable = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory", "save_memory"],
      memories,
    });
    expect(writable).toContain("Saving memories:");
  });

  it("guides the first save when nothing is saved yet, and stays silent read-only", () => {
    const writable = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory", "save_memory"],
      memories: [],
    });
    expect(writable).toContain("Saving memories:");
    expect(writable).not.toContain("Saved memories, carried by every session in this workspace:");

    const readOnly = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory"],
      memories: [],
    });
    expect(readOnly).not.toContain("memories");
  });

  it("indexes a project's memories beside the workspace's, and scopes saving to it", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory", "save_memory"],
      memories: [
        { name: "prefers-bun", description: "Prefers bun over node.", updatedAt: FIXED_NOW },
      ],
      project: {
        name: "Research",
        articles: [],
        memories: [
          { name: "deploy-window", description: "Deploys land on Tuesdays.", updatedAt: FIXED_NOW },
        ],
      },
    });
    expect(prompt).toContain("- prefers-bun: Prefers bun over node.");
    expect(prompt).toContain('Saved memories for the project "Research"');
    expect(prompt).toContain("- deploy-window: Deploys land on Tuesdays.");
    expect(prompt).toContain('Memories you save belong to the project "Research"');
  });

  it("indexes a project's memories when the workspace has none", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory"],
      memories: [],
      project: {
        name: "Research",
        articles: [],
        memories: [
          { name: "deploy-window", description: "Deploys land on Tuesdays.", updatedAt: FIXED_NOW },
        ],
      },
    });
    expect(prompt).toContain("load its full body with read_memory");
    expect(prompt).toContain("- deploy-window: Deploys land on Tuesdays.");
    expect(prompt).not.toContain("Saved memories, carried by every session in this workspace:");
  });

  it("leaves the saving scope unsaid outside a project", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_memory", "save_memory"],
      memories: [],
    });
    expect(prompt).toContain("Saving memories:");
    expect(prompt).not.toContain("Memories you save belong to the project");
  });

  it("maps the project corpus with the curation line when the session can write", () => {
    const prompt = buildSystemPrompt({
      config,
      tools: ["read_article", "create_article"],
      project: {
        name: "Research",
        articles: [{ slug: "corpus-doc", heading: "Field Notes" }],
        memories: [],
      },
      now: FIXED_NOW,
    });
    expect(prompt).toContain('This session belongs to the project "Research"');
    expect(prompt).toContain("its sessions all read and write the same documents");
    expect(prompt).toContain("- corpus-doc: Field Notes");
    expect(prompt).toContain("load an article's body with read_article");
    expect(prompt).toContain("Write durable knowledge into the corpus");
  });

  it("states an empty corpus rather than listing nothing", () => {
    const prompt = buildSystemPrompt({
      config,
      tools: ["read_article", "create_article"],
      project: { name: "Research", articles: [], memories: [] },
      now: FIXED_NOW,
    });
    expect(prompt).toContain("The corpus is currently empty.");
    expect(prompt).not.toContain("The project's articles");
  });

  it("carries no project layer without a project or without read_article", () => {
    const withoutProject = buildSystemPrompt({
      config,
      tools: ["read_article"],
      now: FIXED_NOW,
    });
    expect(withoutProject).not.toContain("belongs to the project");
    const withoutTool = buildSystemPrompt({
      config,
      tools: ["tavily__search"],
      project: { name: "Research", articles: [], memories: [] },
      now: FIXED_NOW,
    });
    expect(withoutTool).not.toContain("belongs to the project");
  });

  it("lists a skill without a description as its bare name", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["use_skill"],
      skills: [{ name: "plain", description: "" }],
    });
    expect(prompt).toContain("Available skills:\n- plain");
    expect(prompt).not.toContain("- plain:");
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
    // roots through errors, and the path currency — absolute results,
    // working-directory-relative inputs allowed — is stated.
    expect(withFilesystem).toContain("- /srv/notes");
    expect(withFilesystem).toContain("- /srv/projects");
    expect(withFilesystem).toContain("relative to the session's working directory");

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

  it("includes shell guidance with the allowed directories only when run_command is active", () => {
    const withShell = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["run_command"],
      allowedDirectories: ["/srv/projects/app", "/srv/projects/lib"],
    });
    expect(withShell).toContain("You can run shell commands");
    // The allowed directories are enumerated so the model needn't discover
    // them through errors, and the session-working-directory default is stated.
    expect(withShell).toContain("- /srv/projects/app");
    expect(withShell).toContain("- /srv/projects/lib");
    expect(withShell).toContain("session's working directory");
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
    });
    expect(withoutShell).not.toContain("You can run shell commands");
    expect(withoutShell).not.toContain("Hard rules");
    expect(buildSystemPrompt({ config, now: FIXED_NOW })).not.toContain(
      "You can run shell commands",
    );
  });

  it("states the session's working directory only when one is set", () => {
    const withCwd = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_file"],
      allowedDirectories: ["/srv/notes"],
      workingDirectory: "/srv/notes/inbox",
    });
    expect(withCwd).toContain("The session's working directory is /srv/notes/inbox");

    const withoutCwd = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_file"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(withoutCwd).not.toContain("The session's working directory");
  });

  it("adds the move-yourself bullet only when set_working_directory is active", () => {
    const withMove = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_file", "set_working_directory"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(withMove).toContain("Move the session's working directory with set_working_directory");

    const withoutMove = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      tools: ["read_file"],
      allowedDirectories: ["/srv/notes"],
    });
    expect(withoutMove).not.toContain("Move the session's working directory");
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

  it("ignores a personas directory left over in the workspace", () => {
    // A workspace may still carry persona overlay files from before kiri read
    // them; they are the user's files and must simply have no effect.
    mkdirSync(join(dir, "personas"), { recursive: true });
    writeFileSync(join(dir, "personas", "poet.md"), "You speak only in verse.");
    const prompt = buildSystemPrompt({ config, now: FIXED_NOW });
    expect(prompt).not.toContain("You speak only in verse.");
  });
});

describe("AGENTS.md chain", () => {
  let dir: string;
  let root: string;
  let config: ConfigStore;

  // <root>/a/b inside the sandbox, with <dir>/outside sitting above it.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-sysprompt-agents-"));
    root = join(dir, "root");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    config = createConfigStore(root);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeAgents = (directory: string, body: string): void => {
    writeFileSync(join(directory, AGENTS_FILENAME), body);
  };

  const bodies = (chain: readonly { text: string }[]): string[] => chain.map(({ text }) => text);

  it("collects the chain from the sandbox root down to the working directory", () => {
    writeAgents(root, "Root rules.");
    writeAgents(join(root, "a"), "A rules.");
    writeAgents(join(root, "a", "b"), "B rules.");
    expect(bodies(readAgentsChain(join(root, "a", "b"), [root]))).toEqual([
      "Root rules.",
      "A rules.",
      "B rules.",
    ]);
  });

  it("keeps only the files that exist", () => {
    writeAgents(root, "Root rules.");
    expect(bodies(readAgentsChain(join(root, "a", "b"), [root]))).toEqual(["Root rules."]);
  });

  it("never reads an AGENTS.md above the allowed directories", () => {
    writeAgents(dir, "Instructions outside the sandbox.");
    writeAgents(root, "Root rules.");
    // The sandbox root is <root>, so the walk passes <dir> but must exclude it
    // by path containment — its contents may not reach the prompt at all.
    expect(bodies(readAgentsChain(join(root, "a"), [root]))).toEqual(["Root rules."]);
  });

  it("excludes an AGENTS.md that symlinks out of the allowed directories", () => {
    writeFileSync(join(dir, "elsewhere.md"), "Smuggled instructions.");
    symlinkSync(join(dir, "elsewhere.md"), join(root, AGENTS_FILENAME));
    expect(readAgentsChain(root, [root])).toEqual([]);
  });

  it("resolves the working directory before testing containment", () => {
    writeAgents(dir, "Instructions outside the sandbox.");
    // A traversal out of the sandbox lands above it, so nothing is collected.
    expect(readAgentsChain(join(root, "a", "..", ".."), [root])).toEqual([]);
  });

  it("skips an empty, whitespace-only, or unreadable AGENTS.md", () => {
    writeAgents(root, "  \n\t\n");
    mkdirSync(join(root, "a", AGENTS_FILENAME));
    writeAgents(join(root, "a", "b"), "B rules.");
    expect(bodies(readAgentsChain(join(root, "a", "b"), [root]))).toEqual(["B rules."]);
  });

  it("collects nothing without a working directory or allowed directories", () => {
    writeAgents(root, "Root rules.");
    expect(readAgentsChain(null, [root])).toEqual([]);
    expect(readAgentsChain(root, [])).toEqual([]);
  });

  it("ignores an allowed directory that doesn't exist and a missing working directory", () => {
    writeAgents(root, "Root rules.");
    expect(bodies(readAgentsChain(root, [join(dir, "gone"), root]))).toEqual(["Root rules."]);
    expect(readAgentsChain(join(root, "gone"), [root])).toEqual([]);
  });

  it("walks up to a second allowed directory's own root", () => {
    const notes = join(dir, "notes");
    mkdirSync(join(notes, "daily"), { recursive: true });
    writeAgents(dir, "Instructions outside the sandbox.");
    writeAgents(notes, "Notes rules.");
    expect(bodies(readAgentsChain(join(notes, "daily"), [root, notes]))).toEqual(["Notes rules."]);
  });

  it("appends the chain after kiri.md, most specific last", () => {
    writeFileSync(config.instructionsFile(), "Be terse.");
    writeAgents(root, "Root rules.");
    writeAgents(join(root, "a"), "A rules.");
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      workingDirectory: join(root, "a"),
      allowedDirectories: [root],
    });
    expect(prompt).toContain("Root rules.");
    // Precedence is carried by ordering, so the nearest file must land last.
    expect(prompt.indexOf("Be terse.")).toBeLessThan(prompt.indexOf("Root rules."));
    expect(prompt.indexOf("Root rules.")).toBeLessThan(prompt.indexOf("A rules."));
  });

  it("adds no layer when no AGENTS.md governs the working directory", () => {
    const prompt = buildSystemPrompt({
      config,
      now: FIXED_NOW,
      workingDirectory: join(root, "a"),
      allowedDirectories: [root],
    });
    expect(prompt).not.toContain(`Standing instructions from the ${AGENTS_FILENAME} files`);
  });

  it("resolves the chain against the session's current working directory", () => {
    writeAgents(join(root, "a", "b"), "B rules.");
    const builder = createSystemPromptBuilder(config, [], [root]);
    const session = (cwd: string): Session =>
      ({ parentSessionId: null, effort: "medium", cwd }) as unknown as Session;
    expect(builder(session(join(root, "a")))).not.toContain("B rules.");
    expect(builder(session(join(root, "a", "b")))).toContain("B rules.");
  });

  it("keeps the chain out of a child session's worker prompt", () => {
    writeAgents(root, "Root rules.");
    const prompt = createSystemPromptBuilder(
      config,
      [],
      [root],
    )({ parentSessionId: "parent", effort: "medium", cwd: root } as unknown as Session);
    expect(prompt).not.toContain("Root rules.");
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
    // The steer must install delegation as the rule for multi-call research,
    // not an optional alternative — triggered by the shape of the request
    // before the first call, the moment a model otherwise slides into inline
    // searching — and the general tool strategy must route research to it
    // before teaching efficient inline calling.
    expect(withDelegate).toContain("Delegation is the rule for research");
    expect(withDelegate).toContain("Route before you run");
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
    expect(withoutDelegate).not.toContain("Delegation is the rule for research");
    expect(withoutDelegate).not.toContain("Route before you run");
  });

  it("adds the model right-sizing rule only when delegate roles are configured", () => {
    const withRoles = buildSystemPrompt({
      config,
      tools: ["delegate"],
      delegateRoles: ["quick", "daily", "deep"],
      now: FIXED_NOW,
    });
    // The steer must demand per-task sizing and give each role an operational
    // trigger, plus name both failure modes — undersizing and oversizing.
    expect(withRoles).toContain("Size each worker's model to its task");
    expect(withRoles).toContain("never one size for the whole batch");
    expect(withRoles).toContain("`quick` runs mechanical, fully-specified legwork");
    // The triggers must speak to coding work as much as research.
    expect(withRoles).toContain(
      "`daily` is the default for ordinary work: research strands, routine coding against a clear spec",
    );
    expect(withRoles).toContain("`deep` is reserved for tasks whose outcome hinges on reasoning");
    expect(withRoles).toContain("subtle code correctness, debugging from symptoms");
    expect(withRoles).toContain("Escalate the one strand that needs it, not the batch");
    expect(withRoles).toContain("costs a rerun");
    // Unconfigured, the tool has no model prop, so the steer must not name one.
    const withoutRoles = buildSystemPrompt({ config, tools: ["delegate"], now: FIXED_NOW });
    expect(withoutRoles).not.toContain("Size each worker's model to its task");
  });

  it("names only the configured roles in the right-sizing rule", () => {
    const partial = buildSystemPrompt({
      config,
      tools: ["delegate"],
      delegateRoles: ["daily"],
      now: FIXED_NOW,
    });
    expect(partial).toContain("`daily` is the default for ordinary work");
    expect(partial).not.toContain("`quick`");
    expect(partial).not.toContain("`deep`");
  });

  it("carries the titling rule whenever delegate is offered", () => {
    // The title prop is required with or without delegate roles, so its steer
    // rides the delegation guidance unconditionally — and it must demand a
    // specific label, not a sentence or a generic filler name.
    for (const delegateRoles of [["daily"] as const, []]) {
      const prompt = buildSystemPrompt({
        config,
        tools: ["delegate"],
        delegateRoles,
        now: FIXED_NOW,
      });
      expect(prompt).toContain("Name each delegation with the required `title` prop");
      expect(prompt).toContain("a label, not a sentence");
      expect(prompt).toContain("make each title specific to its task");
    }
    // No delegate, no delegation steer — including the titling rule.
    const withoutDelegate = buildSystemPrompt({
      config,
      tools: ["tavily__search"],
      now: FIXED_NOW,
    });
    expect(withoutDelegate).not.toContain("Name each delegation");
  });

  it("carries the effort right-sizing rule whenever delegate is offered", () => {
    // The effort prop is required with or without delegate roles, so its
    // steer rides the delegation guidance unconditionally — per task,
    // independent of the model choice, and speaking to coding work as much
    // as research.
    for (const delegateRoles of [["daily"] as const, []]) {
      const prompt = buildSystemPrompt({
        config,
        tools: ["delegate"],
        delegateRoles,
        now: FIXED_NOW,
      });
      expect(prompt).toContain("State each worker's effort with the required `effort` prop");
      expect(prompt).toContain("`medium` is the everyday default for ordinary research and coding");
      expect(prompt).toContain("`xhigh` is for the hardest work");
      expect(prompt).toContain("`max` is the absolute ceiling");
      expect(prompt).toContain(
        "escalate the one strand that needs deep synthesis rather than the batch",
      );
    }
    // No delegate, no delegation steer — including the effort rule.
    const withoutDelegate = buildSystemPrompt({
      config,
      tools: ["tavily__search"],
      now: FIXED_NOW,
    });
    expect(withoutDelegate).not.toContain("State each worker's effort");
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

  it("states the worker's effort level, defaulting to medium", () => {
    expect(buildChildSessionPrompt({ now: FIXED_NOW })).toContain(
      "This session's effort level is set to medium",
    );
    expect(buildChildSessionPrompt({ effort: "low", now: FIXED_NOW })).toContain(
      "This session's effort level is set to low",
    );
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
      workingDirectory: "/workspace/notes/project",
      now: FIXED_NOW,
    });
    expect(prompt).toContain("You can work with the user's files");
    expect(prompt).toContain("You can run shell commands with run_command");
    expect(prompt).toContain("The session's working directory is /workspace/notes/project");
    expect(prompt.split("- /workspace/notes").length).toBe(3);
    // Neither section appears when its tools are absent.
    const bare = buildChildSessionPrompt({ tools: ["tavily__search"], now: FIXED_NOW });
    expect(bare).not.toContain("You can work with the user's files");
    expect(bare).not.toContain("You can run shell commands");
  });

  it("lists the available skills when use_skill is active, so workers can load them too", () => {
    const prompt = buildChildSessionPrompt({
      tools: ["use_skill"],
      skills: [{ name: "release-notes", description: "Draft release notes." }],
      now: FIXED_NOW,
    });
    expect(prompt).toContain("- release-notes: Draft release notes.");
    expect(buildChildSessionPrompt({ tools: ["tavily__search"], now: FIXED_NOW })).not.toContain(
      "Available skills:",
    );
  });

  it("indexes memories for recall without the saving discipline workers can't act on", () => {
    const prompt = buildChildSessionPrompt({
      tools: ["read_memory"],
      memories: [
        { name: "prefers-bun", description: "Prefers bun over node.", updatedAt: FIXED_NOW },
      ],
      now: FIXED_NOW,
    });
    expect(prompt).toContain("- prefers-bun: Prefers bun over node.");
    expect(prompt).not.toContain("Saving memories:");
  });

  it("maps the project corpus read-only: workers get the index without the curation line", () => {
    const prompt = buildChildSessionPrompt({
      tools: ["read_article"],
      project: {
        name: "Research",
        articles: [{ slug: "corpus-doc", heading: "Field Notes" }],
        memories: [],
      },
      now: FIXED_NOW,
    });
    expect(prompt).toContain('This session belongs to the project "Research"');
    expect(prompt).toContain("its sessions all read the same documents");
    expect(prompt).toContain("- corpus-doc: Field Notes");
    expect(prompt).not.toContain("Write durable knowledge into the corpus");
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

  // A minimal session stand-in: the builder reads only `parentSessionId` — a
  // non-null parent marks a child session — plus `effort` for the effort line
  // and `cwd` for the working-directory line.
  const sessionWith = (
    parentSessionId: string | null,
    effort: Session["effort"] = "medium",
    cwd: string | null = null,
  ): Session => ({ parentSessionId, effort, cwd }) as unknown as Session;

  it("states the session's stored working directory, parent and child alike", () => {
    const builder = createSystemPromptBuilder(config);
    expect(builder(sessionWith(null, "medium", "/srv/notes"))).toContain(
      "The session's working directory is /srv/notes",
    );
    expect(builder(sessionWith("parent", "medium", "/srv/notes"))).toContain(
      "The session's working directory is /srv/notes",
    );
    expect(builder(sessionWith(null))).not.toContain("The session's working directory");
  });

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

  it("hands the skill catalogue to parent and child prompts alike", () => {
    const builder = createSystemPromptBuilder(
      config,
      ["use_skill"],
      [],
      [],
      [{ name: "release-notes", description: "Draft release notes." }],
    );
    expect(builder(sessionWith(null))).toContain("- release-notes: Draft release notes.");
    expect(builder(sessionWith("parent"))).toContain("- release-notes: Draft release notes.");
  });

  it("hands the memory index to parent and child prompts alike", () => {
    const builder = createSystemPromptBuilder(
      config,
      ["read_memory"],
      [],
      [],
      [],
      [{ name: "prefers-bun", description: "Prefers bun over node.", updatedAt: new Date() }],
    );
    expect(builder(sessionWith(null))).toContain("- prefers-bun: Prefers bun over node.");
    expect(builder(sessionWith("parent"))).toContain("- prefers-bun: Prefers bun over node.");
  });

  it("states each session's own stored effort, parent and child alike", () => {
    const builder = createSystemPromptBuilder(config);
    expect(builder(sessionWith(null, "high"))).toContain(
      "This session's effort level is set to high",
    );
    expect(builder(sessionWith("parent", "low"))).toContain(
      "This session's effort level is set to low",
    );
  });
});
