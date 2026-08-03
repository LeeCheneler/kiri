import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "ai";
import { type ConfigStore, createConfigStore } from "../config/store.ts";
import { skillTools } from "./skill-tools.ts";

// Minimal execute harness: the tools under test are all server-side executes.
const run = async (tool: Tool | undefined, input: unknown): Promise<unknown> => {
  if (!tool?.execute) throw new Error("tool has no execute");
  return tool.execute(input as never, { toolCallId: "call-1", messages: [] });
};

describe("skillTools", () => {
  let dir: string;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-skill-tools-"));
    config = createConfigStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeSkill = (name: string, content: string): void => {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content);
  };

  it("returns a workspace skill's body", async () => {
    writeSkill("release-notes", "---\ndescription: Draft release notes.\n---\nThe instructions.\n");
    expect(await run(skillTools(config).use_skill, { name: "release-notes" })).toBe(
      "The instructions.",
    );
  });

  it("serves the first-party workflow-authoring skill", async () => {
    const body = await run(skillTools(config).use_skill, { name: "workflow-authoring" });
    expect(body).toContain("# Kiri workflow authoring guide");
  });

  it("reads skills fresh on every call, so an edit applies immediately", async () => {
    writeSkill("notes", "First version.\n");
    const tools = skillTools(config);
    expect(await run(tools.use_skill, { name: "notes" })).toBe("First version.");
    writeSkill("notes", "Second version.\n");
    expect(await run(tools.use_skill, { name: "notes" })).toBe("Second version.");
  });

  it("rejects an unknown skill, naming the available ones", async () => {
    writeSkill("release-notes", "Body.\n");
    expect(run(skillTools(config).use_skill, { name: "nope" })).rejects.toThrow(
      'No skill named "nope" — available skills: "release-notes", "workflow-authoring".',
    );
  });
});
