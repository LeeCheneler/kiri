import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createApp } from "../index.ts";
import { createProject } from "../projects/store.ts";
import {
  createTask,
  createTaskGroup,
  getTask,
  getTaskGroup,
  listTaskGroups,
} from "../projects/tasks.ts";
import { CLIENT_HEADERS, type TestEnv, createTestEnv } from "./test-helpers.ts";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { ...CLIENT_HEADERS, "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("project task routes", () => {
  let env: TestEnv;
  let bus: EventBus;
  let events: KiriEvent[];
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    env = createTestEnv();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
    app = createApp({ db: env.db, registry: env.registry, config: env.config, env: {}, bus });
    createProject(env.db, "Atlas", { id: "p1" });
    createProject(env.db, "Beacon", { id: "p2" });
    createTaskGroup(env.db, "p1", "Now", { id: "g1" });
    createTaskGroup(env.db, "p1", "Later", { id: "g2" });
    createTaskGroup(env.db, "p2", "Other", { id: "g9" });
    createTask(env.db, "g1", { title: "one" }, { id: "t1" });
    createTask(env.db, "g1", { title: "two" }, { id: "t2" });
    createTask(env.db, "g9", { title: "foreign" }, { id: "t9" });
  });

  afterEach(() => {
    env.dispose();
  });

  const changedEvents = () => events.filter((event) => event.type === "task.changed");

  describe("GET /api/projects/:id/tasks", () => {
    it("returns the project's groups with their tasks", async () => {
      const res = await app.request("/api/projects/p1/tasks");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { groups: { id: string; tasks: { id: string }[] }[] };
      expect(body.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
      expect(body.groups[0]?.tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
    });

    it("404s for an unknown project", async () => {
      expect((await app.request("/api/projects/nope/tasks")).status).toBe(404);
    });
  });

  describe("task groups", () => {
    it("creates a group and publishes task.changed", async () => {
      const res = await app.request(
        "/api/projects/p1/task-groups",
        json("POST", { name: "Someday" }),
      );
      expect(res.status).toBe(201);
      const { group } = (await res.json()) as { group: { name: string; position: number } };
      expect(group).toMatchObject({ name: "Someday", position: 2 });
      expect(changedEvents()).toEqual([{ type: "task.changed", projectId: "p1" }]);
    });

    it("409s on a duplicate name, 404s on an unknown project, 400s on a blank name", async () => {
      expect(
        (await app.request("/api/projects/p1/task-groups", json("POST", { name: "Now" }))).status,
      ).toBe(409);
      expect(
        (await app.request("/api/projects/nope/task-groups", json("POST", { name: "X" }))).status,
      ).toBe(404);
      expect(
        (await app.request("/api/projects/p1/task-groups", json("POST", { name: " " }))).status,
      ).toBe(400);
      expect(changedEvents()).toEqual([]);
    });

    it("reorders groups", async () => {
      const res = await app.request(
        "/api/projects/p1/task-groups",
        json("PUT", { orderedIds: ["g2", "g1"] }),
      );
      expect(res.status).toBe(204);
      expect(listTaskGroups(env.db, "p1").map((group) => group.id)).toEqual(["g2", "g1"]);
      expect(
        (await app.request("/api/projects/nope/task-groups", json("PUT", { orderedIds: [] })))
          .status,
      ).toBe(404);
    });

    it("renames a group, refusing a clash with another group", async () => {
      const res = await app.request(
        "/api/projects/p1/task-groups/g1",
        json("PATCH", { name: "Today" }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { group: { name: string } }).group.name).toBe("Today");
      expect(
        (await app.request("/api/projects/p1/task-groups/g1", json("PATCH", { name: "Today" })))
          .status,
      ).toBe(200);
      expect(
        (await app.request("/api/projects/p1/task-groups/g1", json("PATCH", { name: "Later" })))
          .status,
      ).toBe(409);
      // A group under another project reads as absent here.
      expect(
        (await app.request("/api/projects/p1/task-groups/g9", json("PATCH", { name: "X" }))).status,
      ).toBe(404);
    });

    it("deletes a group with its tasks", async () => {
      expect(
        (
          await app.request("/api/projects/p1/task-groups/g1", {
            method: "DELETE",
            headers: CLIENT_HEADERS,
          })
        ).status,
      ).toBe(204);
      expect(getTaskGroup(env.db, "g1")).toBeUndefined();
      expect(getTask(env.db, "t1")).toBeUndefined();
      expect(
        (
          await app.request("/api/projects/p1/task-groups/g9", {
            method: "DELETE",
            headers: CLIENT_HEADERS,
          })
        ).status,
      ).toBe(404);
      expect(changedEvents()).toHaveLength(1);
    });
  });

  describe("tasks", () => {
    it("creates a task in a group", async () => {
      const res = await app.request(
        "/api/projects/p1/task-groups/g2/tasks",
        json("POST", { title: "three", note: "ctx" }),
      );
      expect(res.status).toBe(201);
      const { task } = (await res.json()) as {
        task: { groupId: string; title: string; note: string };
      };
      expect(task).toMatchObject({ groupId: "g2", title: "three", note: "ctx" });
      expect(
        (await app.request("/api/projects/p1/task-groups/g9/tasks", json("POST", { title: "x" })))
          .status,
      ).toBe(404);
      expect(changedEvents()).toHaveLength(1);
    });

    it("reorders a group's tasks", async () => {
      const res = await app.request(
        "/api/projects/p1/task-groups/g1/tasks",
        json("PUT", { orderedIds: ["t2", "t1"] }),
      );
      expect(res.status).toBe(204);
      expect(listTaskGroups(env.db, "p1")[0]?.tasks.map((task) => task.id)).toEqual(["t2", "t1"]);
      expect(
        (
          await app.request(
            "/api/projects/p1/task-groups/g9/tasks",
            json("PUT", { orderedIds: [] }),
          )
        ).status,
      ).toBe(404);
    });

    it("patches a task's fields and moves it between groups", async () => {
      const res = await app.request(
        "/api/projects/p1/tasks/t1",
        json("PATCH", { done: true, note: "did it" }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as { task: { done: boolean; note: string } }).task).toMatchObject({
        done: true,
        note: "did it",
      });
      const moved = await app.request(
        "/api/projects/p1/tasks/t1",
        json("PATCH", { groupId: "g2" }),
      );
      expect(((await moved.json()) as { task: { groupId: string } }).task.groupId).toBe("g2");
      // Moving into another project's group is refused.
      expect(
        (await app.request("/api/projects/p1/tasks/t2", json("PATCH", { groupId: "g9" }))).status,
      ).toBe(404);
      expect(
        (await app.request("/api/projects/p1/tasks/t9", json("PATCH", { done: true }))).status,
      ).toBe(404);
      expect(
        (await app.request("/api/projects/p1/tasks/t1", json("PATCH", { bogus: 1 }))).status,
      ).toBe(400);
      expect(changedEvents()).toHaveLength(2);
    });

    it("deletes a task", async () => {
      expect(
        (
          await app.request("/api/projects/p1/tasks/t1", {
            method: "DELETE",
            headers: CLIENT_HEADERS,
          })
        ).status,
      ).toBe(204);
      expect(getTask(env.db, "t1")).toBeUndefined();
      expect(
        (
          await app.request("/api/projects/p1/tasks/t9", {
            method: "DELETE",
            headers: CLIENT_HEADERS,
          })
        ).status,
      ).toBe(404);
      expect(changedEvents()).toHaveLength(1);
    });
  });
});
