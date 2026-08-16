import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createProject, deleteProject } from "./store.ts";
import {
  countOpenTasksByProject,
  createTask,
  createTaskGroup,
  deleteTask,
  deleteTaskGroup,
  ensureTaskGroup,
  getProjectTask,
  getTask,
  getTaskGroup,
  getTaskGroupByName,
  listTaskGroups,
  renameTaskGroup,
  reorderTaskGroups,
  reorderTasks,
  updateTask,
} from "./tasks.ts";

describe("project tasks store", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-tasks-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createProject(db, "Atlas", { id: "p1" });
    createProject(db, "Beacon", { id: "p2" });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates groups at the end of the project's list", () => {
    const first = createTaskGroup(db, "p1", "  Backlog ", { id: "g1" });
    const second = createTaskGroup(db, "p1", "Now", { id: "g2" });

    expect(first.name).toBe("Backlog");
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(getTaskGroup(db, "g1")?.projectId).toBe("p1");
    expect(getTaskGroupByName(db, "p1", "Now")?.id).toBe("g2");
    expect(getTaskGroupByName(db, "p2", "Now")).toBeUndefined();
  });

  it("rejects a duplicate group name within a project but not across projects", () => {
    createTaskGroup(db, "p1", "Now");
    expect(() => createTaskGroup(db, "p1", "Now")).toThrow();
    expect(createTaskGroup(db, "p2", "Now").projectId).toBe("p2");
  });

  it("ensures a group by name, creating it once", () => {
    const created = ensureTaskGroup(db, "p1", "Later");
    const again = ensureTaskGroup(db, "p1", " Later ");
    expect(again.id).toBe(created.id);
    expect(listTaskGroups(db, "p1")).toHaveLength(1);
  });

  it("creates tasks at the end of their group with a normalised note", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    const a = createTask(db, "g1", { title: " Write docs ", note: "  " }, { id: "t1" });
    const b = createTask(db, "g1", { title: "Ship", note: " blocked on review " }, { id: "t2" });

    expect(a.title).toBe("Write docs");
    expect(a.note).toBeNull();
    expect(a.done).toBe(false);
    expect(a.position).toBe(0);
    expect(b.note).toBe("blocked on review");
    expect(b.position).toBe(1);
  });

  it("lists groups in position order, each with its tasks in position order", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTaskGroup(db, "p1", "Later", { id: "g2" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });
    createTask(db, "g1", { title: "two" }, { id: "t2" });
    createTask(db, "g2", { title: "three" }, { id: "t3" });
    createTaskGroup(db, "p2", "Elsewhere", { id: "g9" });

    const groups = listTaskGroups(db, "p1");
    expect(groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(groups[0]?.tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
    expect(groups[1]?.tasks.map((task) => task.id)).toEqual(["t3"]);
    expect(listTaskGroups(db, "p2")).toHaveLength(1);
    expect(listTaskGroups(db, "missing")).toEqual([]);
  });

  it("scopes task lookups to a project", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });

    expect(getProjectTask(db, "p1", "t1")?.id).toBe("t1");
    expect(getProjectTask(db, "p2", "t1")).toBeUndefined();
    expect(getProjectTask(db, "p1", "missing")).toBeUndefined();
  });

  it("updates title, note, and completion, bumping updatedAt", async () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    const created = createTask(db, "g1", { title: "one" }, { id: "t1", createdAt: new Date(1000) });

    const done = updateTask(db, "t1", { done: true });
    expect(done.done).toBe(true);
    expect(done.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    const edited = updateTask(db, "t1", { title: " renamed ", note: "ctx" });
    expect(edited.title).toBe("renamed");
    expect(edited.note).toBe("ctx");
    expect(updateTask(db, "t1", { note: "" }).note).toBeNull();
    expect(updateTask(db, "t1", {}).title).toBe("renamed");
  });

  it("moves a task to the end of another group", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTaskGroup(db, "p1", "Later", { id: "g2" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });
    createTask(db, "g2", { title: "two" }, { id: "t2" });

    const moved = updateTask(db, "t1", { groupId: "g2" });
    expect(moved.groupId).toBe("g2");
    expect(moved.position).toBe(1);
    expect(updateTask(db, "t1", { groupId: "g2" }).position).toBe(1);
  });

  it("reorders tasks within a group, tolerating partial and foreign ids", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });
    createTask(db, "g1", { title: "two" }, { id: "t2" });
    createTask(db, "g1", { title: "three" }, { id: "t3" });

    reorderTasks(db, "g1", ["t3", "bogus", "t1"]);
    expect(listTaskGroups(db, "p1")[0]?.tasks.map((task) => task.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("reorders and renames groups", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTaskGroup(db, "p1", "Later", { id: "g2" });
    createTaskGroup(db, "p1", "Someday", { id: "g3" });

    reorderTaskGroups(db, "p1", ["g3", "g1"]);
    expect(listTaskGroups(db, "p1").map((group) => group.id)).toEqual(["g3", "g1", "g2"]);
    expect(renameTaskGroup(db, "g1", " Today ").name).toBe("Today");
  });

  it("deletes a task, and a group with its tasks", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });
    createTask(db, "g1", { title: "two" }, { id: "t2" });

    deleteTask(db, "t1");
    expect(getTask(db, "t1")).toBeUndefined();
    deleteTaskGroup(db, "g1");
    expect(getTask(db, "t2")).toBeUndefined();
    expect(getTaskGroup(db, "g1")).toBeUndefined();
    deleteTaskGroup(db, "g1");
  });

  it("counts open tasks per project", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });
    createTask(db, "g1", { title: "two" }, { id: "t2" });
    updateTask(db, "t2", { done: true });
    createTaskGroup(db, "p2", "Now", { id: "g2" });

    const counts = countOpenTasksByProject(db);
    expect(counts.get("p1")).toBe(1);
    expect(counts.has("p2")).toBe(false);
  });

  it("is removed by the project cascade", () => {
    createTaskGroup(db, "p1", "Now", { id: "g1" });
    createTask(db, "g1", { title: "one" }, { id: "t1" });

    deleteProject(db, "p1");
    expect(getTaskGroup(db, "g1")).toBeUndefined();
    expect(getTask(db, "t1")).toBeUndefined();
  });
});
