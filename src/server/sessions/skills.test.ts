import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import type { HostEnvironment } from "./host-environment.ts";
import { listSkills } from "./skills.ts";
import { buildWorkflowAuthoringGuide } from "./workflow-authoring-guide.ts";

const HOST: HostEnvironment = { platform: "darwin", release: "25.0.0", arch: "arm64" };

describe("listSkills", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-skills-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeSkill = (name: string, content: string): void => {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content);
  };

  it("serves the first-party workflow-authoring skill without a skills directory", () => {
    const skills = listSkills(config, HOST);
    expect(skills.map((skill) => skill.name)).toEqual(["workflow-authoring"]);
    expect(skills[0].description).not.toBe("");
    expect(skills[0].load()).toBe(buildWorkflowAuthoringGuide(HOST));
  });

  it("detects the running machine's host for the first-party skill when none is injected", () => {
    const skills = listSkills(config);
    expect(skills.find((skill) => skill.name === "workflow-authoring")?.load()).toContain(
      "This machine",
    );
  });

  it("discovers workspace skills from skills/<name>/SKILL.md, keyed by directory name", () => {
    writeSkill("release-notes", "---\ndescription: Draft release notes.\n---\nUse this format.\n");
    const skills = listSkills(config, HOST);
    const skill = skills.find((entry) => entry.name === "release-notes");
    expect(skill?.description).toBe("Draft release notes.");
    // The body is the file with its frontmatter stripped.
    expect(skill?.load()).toBe("Use this format.");
  });

  it("prefers a frontmatter name over the directory name", () => {
    writeSkill("some-dir", "---\nname: reviews\ndescription: Review PRs.\n---\nBody.\n");
    expect(listSkills(config, HOST).map((skill) => skill.name)).toEqual([
      "reviews",
      "workflow-authoring",
    ]);
  });

  it("ignores unknown frontmatter fields so ecosystem skills drop in unmodified", () => {
    writeSkill(
      "ecosystem",
      "---\nname: ecosystem\ndescription: An imported skill.\nlicense: MIT\nallowed-tools: [Bash]\nmetadata:\n  author: someone\n---\nInstructions.\n",
    );
    const skill = listSkills(config, HOST).find((entry) => entry.name === "ecosystem");
    expect(skill?.description).toBe("An imported skill.");
    expect(skill?.load()).toBe("Instructions.");
  });

  it("treats a file without frontmatter as all body, with an empty description", () => {
    writeSkill("plain", "Just the instructions.\n");
    const skill = listSkills(config, HOST).find((entry) => entry.name === "plain");
    expect(skill?.description).toBe("");
    expect(skill?.load()).toBe("Just the instructions.");
  });

  it("degrades unparseable frontmatter to defaults rather than failing discovery", () => {
    writeSkill("broken", "---\n{ not: [valid\n---\nStill usable.\n");
    const skill = listSkills(config, HOST).find((entry) => entry.name === "broken");
    expect(skill?.description).toBe("");
    expect(skill?.load()).toBe("Still usable.");
  });

  it("falls back to the directory name for a blank or non-string frontmatter name", () => {
    writeSkill("listy", "---\nname: [not, a, string]\ndescription: 42\n---\nBody.\n");
    writeSkill("blank", '---\nname: "  "\n---\nBody.\n');
    const names = listSkills(config, HOST).map((skill) => skill.name);
    expect(names).toEqual(["blank", "listy", "workflow-authoring"]);
  });

  it("lets a workspace skill replace a first-party skill of the same name", () => {
    writeSkill("workflow-authoring", "---\ndescription: My own rules.\n---\nMy way.\n");
    const skills = listSkills(config, HOST);
    expect(skills.map((skill) => skill.name)).toEqual(["workflow-authoring"]);
    expect(skills[0].description).toBe("My own rules.");
    expect(skills[0].load()).toBe("My way.");
  });

  it("skips loose files, directories without a SKILL.md, and an unreadable SKILL.md", () => {
    mkdirSync(join(dir, "skills", "empty"), { recursive: true });
    writeFileSync(join(dir, "skills", "README.md"), "not a skill");
    // A directory named SKILL.md exists but can't be read as a file.
    mkdirSync(join(dir, "skills", "odd", "SKILL.md"), { recursive: true });
    expect(listSkills(config, HOST).map((skill) => skill.name)).toEqual(["workflow-authoring"]);
  });

  it("returns skills sorted by name", () => {
    writeSkill("zeta", "z\n");
    writeSkill("alpha", "a\n");
    expect(listSkills(config, HOST).map((skill) => skill.name)).toEqual([
      "alpha",
      "workflow-authoring",
      "zeta",
    ]);
  });
});
