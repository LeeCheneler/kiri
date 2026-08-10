import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import { createProject, getProject, updateProject } from "../projects/store.ts";
import { projectTools } from "./project-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("projectTools", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];
  let projectId: string;
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-project-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    events = [];
    projectId = createProject(db, "Atlas").id;
    tools = projectTools(db, projectId, (event: KiriEvent) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("offers no tools to a projectless session", () => {
    expect(projectTools(db, null, () => {})).toEqual({});
  });

  it("writes the instructions, publishes project.updated, and returns a diff", async () => {
    const output = (await run(tools.update_project_instructions, {
      instructions_md: "Answer in British English.",
    })) as { project: string; instructions: string; diff: string };

    expect(getProject(db, projectId)?.instructions).toBe("Answer in British English.");
    expect(output.project).toBe("Atlas");
    expect(output.instructions).toBe("updated");
    expect(output.diff).toContain("+Answer in British English.");
    expect(events).toEqual([{ type: "project.updated", id: projectId }]);
  });

  it("diffs a rewrite against the instructions it replaces", async () => {
    updateProject(db, projectId, { instructions: "Old rule.\nKept rule." });

    const output = (await run(tools.update_project_instructions, {
      instructions_md: "New rule.\nKept rule.",
    })) as { diff: string };

    expect(output.diff).toContain("-Old rule.");
    expect(output.diff).toContain("+New rule.");
    expect(output.diff).toContain(" Kept rule.");
  });

  it("clears the instructions when given a blank body", async () => {
    updateProject(db, projectId, { instructions: "Answer in British English." });

    const output = (await run(tools.update_project_instructions, {
      instructions_md: "   ",
    })) as { instructions: string };

    expect(output.instructions).toBe("cleared");
    expect(getProject(db, projectId)?.instructions).toBeNull();
  });

  it("fails when the session's project has been deleted", async () => {
    const orphan = projectTools(db, "gone", () => {});

    expect(
      run(orphan.update_project_instructions, { instructions_md: "Anything." }),
    ).rejects.toThrow("no longer exists");
  });

  it("strips the diff from what the model receives via toModelOutput", async () => {
    const output = {
      project: "Atlas",
      instructions: "updated",
      diff: "-a\n+b",
      diffTruncated: true,
    };

    const result = await tools.update_project_instructions.toModelOutput?.({
      toolCallId: "call-1",
      input: { instructions_md: "b" },
      output,
    });

    expect(result).toEqual({
      type: "json",
      value: { project: "Atlas", instructions: "updated" },
    });
  });
});
