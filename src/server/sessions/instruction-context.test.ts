import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { createConfigStore } from "../config/store.ts";
import { createInstructionContext } from "./instruction-context.ts";
import type { InstructionSources } from "./instructions.ts";

describe("instruction context", () => {
  let root: string;
  let sources: InstructionSources;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kiri-instruction-context-")));
    sources = {
      config: createConfigStore(root),
      workingDirectory: root,
      allowedDirectories: [root],
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("does not treat discovering rules as delivering them to the model", () => {
    const nested = join(root, "nested");
    mkdirSync(nested);
    writeFileSync(join(root, "AGENTS.md"), "Root rule.");
    writeFileSync(join(nested, "AGENTS.md"), "Nested rule.");
    const context = createInstructionContext(() => sources);
    expect(context.resolve(sources).directories).toEqual([{ directory: root, text: "Root rule." }]);
    expect(() => context.requireForDirectory(nested)).toThrow("Nothing was changed or started");
    expect(() => context.requireForDirectory(nested)).toThrow("Nothing was changed or started");
    expect(context.resolve(sources).directories).toEqual([
      { directory: root, text: "Root rule." },
      { directory: nested, text: "Nested rule." },
    ]);
    expect(() => context.requireForDirectory(nested)).not.toThrow();
    expect(() => context.requireForDirectory(root)).not.toThrow();
  });

  it.each(["workspace", "project", "directory"] as const)(
    "rechecks changed and removed %s rules before mutations",
    (layer) => {
      const setRule = (text: string) => {
        if (layer === "project") sources.project = { name: "Project", instructions: text };
        else writeFileSync(join(root, layer === "workspace" ? "kiri.md" : "AGENTS.md"), text);
      };
      setRule("Original rule.");
      const context = createInstructionContext(() => sources);
      context.resolve(sources);
      expect(() => context.requireForDirectory(root)).not.toThrow();
      for (const text of ["Revised rule.", ""]) {
        setRule(text);
        expect(() => context.requireForDirectory(root)).toThrow("before retrying");
        context.resolve(sources);
        expect(() => context.requireForDirectory(root)).not.toThrow();
      }
    },
  );

  it("loads the ancestor rules before creating missing parents", () => {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "AGENTS.md"), "Creation rule.");
    const context = createInstructionContext(() => sources);
    context.resolve(sources);
    const target = join(root, "nested", "missing", "deeper");
    expect(() => context.requireForDirectory(target)).toThrow("before retrying");
    expect(context.resolve(sources).directories.at(-1)?.text).toBe("Creation rule.");
    expect(() => context.requireForDirectory(target)).not.toThrow();
  });

  it("restores delivered hashes for approval, then rechecks the current sources", () => {
    writeFileSync(join(root, "AGENTS.md"), "Approval rule.");
    const original = createInstructionContext(() => sources);
    original.resolve(sources);
    original.requireForDirectory(root);
    const parts: UIMessage["parts"] = [
      {
        type: "data-instructions",
        id: "standing-instructions",
        data: original.receipt(),
      },
    ];
    expect(JSON.stringify(parts)).not.toContain("Approval rule.");
    const resumed = createInstructionContext(() => sources);
    resumed.restore(parts);
    expect(() => resumed.requireForDirectory(root)).not.toThrow();
    writeFileSync(join(root, "AGENTS.md"), "New approval rule.");
    expect(() => resumed.requireForDirectory(root)).toThrow("before retrying");
    expect(resumed.resolve(sources).directories[0]?.text).toBe("New approval rule.");
    expect(() => resumed.requireForDirectory(root)).not.toThrow();
    resumed.restore([]);
    expect(resumed.receipt()).toBeNull();
    expect(() => resumed.requireForDirectory(root)).toThrow("before retrying");
  });

  it("permits work without optional rules even when a legacy approval has no receipt", () => {
    sources = {};
    const context = createInstructionContext(() => sources);
    expect(() => context.requireForDirectory(root)).not.toThrow();
    expect(() => context.requireForDirectory(root, { scope: "workflow" })).not.toThrow();
    expect(context.resolve(sources)).toEqual({ workspace: null, project: null, directories: [] });
  });

  it("uses workspace authority for workflow rules without widening filesystem scopes", () => {
    const workflows = join(root, "workflows");
    mkdirSync(workflows);
    writeFileSync(join(workflows, "AGENTS.md"), "Workflow rule.");
    sources.allowedDirectories = [];
    const context = createInstructionContext(() => sources);
    context.resolve(sources);
    expect(() => context.requireForDirectory(workflows)).not.toThrow();
    expect(() => context.requireForDirectory(workflows, { scope: "workflow" })).toThrow(
      "before retrying",
    );
    expect(context.resolve(sources).directories).toEqual([
      { directory: workflows, text: "Workflow rule." },
    ]);
    expect(() => context.requireForDirectory(workflows, { scope: "workflow" })).not.toThrow();
  });

  it("checks recursive descendants without promoting internal paths or symlink targets", () => {
    const target = join(root, "tree");
    const nested = join(target, "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "AGENTS.md"), "Deletion rule.");
    for (const name of [".git", ".kiri", ".env-fixture"]) {
      mkdirSync(join(target, name));
      writeFileSync(join(target, name, "AGENTS.md"), "Internal marker.");
    }
    const sibling = join(root, "sibling");
    mkdirSync(sibling);
    writeFileSync(join(sibling, "AGENTS.md"), "Sibling marker.");
    symlinkSync(sibling, join(target, "link"));
    const context = createInstructionContext(() => sources);
    context.resolve(sources);
    expect(() => context.requireForDirectory(target, { recursive: true })).toThrow(
      "before retrying",
    );
    expect(context.resolve(sources).directories).toEqual([
      { directory: nested, text: "Deletion rule." },
    ]);
    expect(() => context.requireForDirectory(target, { recursive: true })).not.toThrow();
    rmSync(target, { recursive: true });
    expect(context.resolve(sources).directories).toEqual([]);
  });

  it("keeps sibling scopes separate and drops their changed rules before the next mutation", () => {
    const a = join(root, "a");
    const b = join(root, "b");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "AGENTS.md"), "A rule.");
    writeFileSync(join(b, "AGENTS.md"), "B rule.");
    const context = createInstructionContext(() => sources);
    context.resolve(sources);
    expect(() => context.requireForDirectory(a)).toThrow();
    context.resolve(sources);
    expect(() => context.requireForDirectory(b)).toThrow();
    context.resolve(sources);
    writeFileSync(join(a, "AGENTS.md"), "Changed A.");
    expect(() => context.requireForDirectory(b)).not.toThrow();
    expect(() => context.requireForDirectory(a)).toThrow();
    sources.allowedDirectories = [b];
    expect(context.resolve(sources).directories).toEqual([{ directory: b, text: "B rule." }]);
  });
});
