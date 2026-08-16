import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { KiriEvent } from "../events/index.ts";
import { createProject } from "../projects/store.ts";
import {
  createTask,
  createTaskGroup,
  getTask,
  listTaskGroups,
  updateTaskGroup,
} from "../projects/tasks.ts";
import { summariseTaskList, taskTools } from "./task-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("taskTools", () => {
  let dir: string;
  let db: KiriDb;
  let events: KiriEvent[];
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-task-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    events = [];
    createProject(db, "Atlas", { id: "p1" });
    createProject(db, "Beacon", { id: "p2" });
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTaskGroup(db, "p1", "Later", { id: "g2" });
    createTask(db, "g1", { title: "one", note: "ctx" }, { id: "t1" });
    createTask(db, "g1", { title: "two" }, { id: "t2" });
    createTaskGroup(db, "p2", "Other", { id: "g9" });
    createTask(db, "g9", { title: "foreign" }, { id: "t9" });
    tools = taskTools(db, "p1", (event: KiriEvent) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const order = (groupId: string) =>
    listTaskGroups(db, "p1")
      .find((group) => group.id === groupId)
      ?.tasks.map((task) => task.id);

  it("offers no tools to a projectless session", () => {
    expect(taskTools(db, null, () => {})).toEqual({});
  });

  it("summarises a project's list as visible group, open, and hidden counts", () => {
    expect(summariseTaskList(db, "p1")).toEqual({ groups: 2, open: 2, hidden: 0 });
    updateTaskGroup(db, "g1", { hidden: true });
    expect(summariseTaskList(db, "p1")).toEqual({ groups: 1, open: 0, hidden: 1 });
    expect(summariseTaskList(db, "missing")).toEqual({ groups: 0, open: 0, hidden: 0 });
  });

  it("leaves hidden groups out of list_tasks unless asked, marking them when included", async () => {
    updateTaskGroup(db, "g2", { hidden: true });
    const visible = (await run(tools.list_tasks, {})) as { groups: { name: string }[] };
    expect(visible.groups.map((group) => group.name)).toEqual(["Now"]);
    const all = (await run(tools.list_tasks, { include_hidden: true })) as {
      groups: { name: string; hidden?: boolean }[];
    };
    expect(all.groups).toMatchObject([{ name: "Now" }, { name: "Later", hidden: true }]);
  });

  it("hides and unhides a group through update_task_group", async () => {
    expect(await run(tools.update_task_group, { name: "Later", hidden: true })).toEqual({
      group: "Later",
      hidden: true,
      updated: true,
    });
    expect(listTaskGroups(db, "p1").find((group) => group.id === "g2")?.hidden).toBe(true);
    expect(await run(tools.update_task_group, { name: "Later", hidden: false })).toEqual({
      group: "Later",
      updated: true,
    });
  });

  it("lists groups with tasks by id, carrying notes only when present", async () => {
    const output = (await run(tools.list_tasks, {})) as {
      groups: { name: string; tasks: Record<string, unknown>[] }[];
    };
    expect(output.groups.map((group) => group.name)).toEqual(["Now", "Later"]);
    expect(output.groups[0]?.tasks).toEqual([
      { id: "t1", title: "one", done: false, note: "ctx" },
      { id: "t2", title: "two", done: false },
    ]);
  });

  it("adds a task, creating the group on the fly, and publishes task.changed", async () => {
    const output = (await run(tools.add_task, {
      group: "Someday",
      title: " three ",
      note: "why",
    })) as { group: string; task: { id: string; title: string; note: string } };
    expect(output.group).toBe("Someday");
    expect(output.task).toMatchObject({ title: "three", note: "why" });
    expect(listTaskGroups(db, "p1").map((group) => group.name)).toEqual([
      "Now",
      "Later",
      "Someday",
    ]);
    expect(events).toEqual([{ type: "task.changed", projectId: "p1" }]);
  });

  it("updates a task's fields, moves it between groups, and repositions it", async () => {
    const done = (await run(tools.update_task, { id: "t1", done: true, note: null })) as {
      task: { done: boolean; note?: string };
    };
    expect(done.task.done).toBe(true);
    expect(done.task.note).toBeUndefined();

    await run(tools.update_task, { id: "t1", group: "Later", title: "renamed" });
    expect(getTask(db, "t1")).toMatchObject({ groupId: "g2", title: "renamed" });

    createTask(db, "g2", { title: "tail" }, { id: "t3" });
    await run(tools.update_task, { id: "t3", position: 0 });
    expect(order("g2")).toEqual(["t3", "t1"]);
    await run(tools.update_task, { id: "t3", position: 99 });
    expect(order("g2")).toEqual(["t1", "t3"]);
    expect(events).toHaveLength(4);
  });

  it("refuses unknown and cross-project task ids", async () => {
    await expect(run(tools.update_task, { id: "nope", done: true })).rejects.toThrow(
      'No task with id "nope"',
    );
    await expect(run(tools.delete_task, { id: "t9" })).rejects.toThrow("call list_tasks");
    expect(events).toEqual([]);
  });

  it("deletes a task", async () => {
    const output = await run(tools.delete_task, { id: "t2" });
    expect(output).toEqual({ id: "t2", title: "two", deleted: true });
    expect(getTask(db, "t2")).toBeUndefined();
    expect(events).toHaveLength(1);
  });

  it("creates a group, refusing a duplicate name", async () => {
    expect(await run(tools.create_task_group, { name: "Backlog" })).toEqual({
      group: "Backlog",
      created: true,
    });
    await expect(run(tools.create_task_group, { name: "Now" })).rejects.toThrow("already exists");
    expect(events).toHaveLength(1);
  });

  it("renames and repositions a group, refusing a clash", async () => {
    expect(
      await run(tools.update_task_group, { name: "Later", new_name: "Soon", position: 0 }),
    ).toEqual({
      group: "Soon",
      updated: true,
    });
    expect(listTaskGroups(db, "p1").map((group) => group.name)).toEqual(["Soon", "Now"]);
    // Renaming to its own name is a no-op, not a clash.
    await run(tools.update_task_group, { name: "Soon", new_name: "Soon" });
    await expect(run(tools.update_task_group, { name: "Soon", new_name: "Now" })).rejects.toThrow(
      "already exists",
    );
    await expect(run(tools.update_task_group, { name: "Other" })).rejects.toThrow(
      'No task group named "Other"',
    );
  });

  it("deletes a group with its tasks", async () => {
    expect(await run(tools.delete_task_group, { name: "Now" })).toEqual({
      group: "Now",
      deleted: true,
    });
    expect(getTask(db, "t1")).toBeUndefined();
    expect(listTaskGroups(db, "p1").map((group) => group.name)).toEqual(["Later"]);
  });
});
