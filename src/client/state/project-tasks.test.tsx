import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useProjectTaskMutations, useProjectTasks, useProjectTasksLive } from "./project-tasks.ts";
import { useProjects } from "./projects.ts";
import { createQueryClient } from "./query-client.ts";

const group = (id: string, name: string, titles: string[] = []) => ({
  id,
  projectId: "p1",
  name,
  position: 0,
  hidden: false,
  createdAt: "2026-08-16T10:00:00.000Z",
  tasks: titles.map((title, index) => ({
    id: `${id}-${index}`,
    groupId: id,
    title,
    done: false,
    note: null,
    createdAt: "2026-08-16T10:00:00.000Z",
    updatedAt: "2026-08-16T10:00:00.000Z",
  })),
});

const ListProbe = ({ projectId = "p1" }: { projectId?: string }) => {
  useProjectTasksLive();
  const groups = useProjectTasks(projectId).data ?? [];
  const projects = useProjects().data ?? [];
  return (
    <div>
      <p>groups:{groups.map((g) => `${g.name}(${g.tasks.length})`).join(",")}</p>
      <p>projects:{projects.map((p) => `${p.id}:${p.openTaskCount}`).join(",")}</p>
    </div>
  );
};

const MutateProbe = () => {
  const m = useProjectTaskMutations("p1");
  const groups = useProjectTasks("p1").data ?? [];
  return (
    <div>
      <p>groups:{groups.map((g) => `${g.name}(${g.tasks.length})`).join(",")}</p>
      <button type="button" onClick={() => void m.createGroup("Later")}>
        create group
      </button>
      <button type="button" onClick={() => void m.updateGroup("g1", { name: "Today" })}>
        rename group
      </button>
      <button type="button" onClick={() => void m.reorderGroups(["g1"])}>
        reorder groups
      </button>
      <button type="button" onClick={() => void m.deleteGroup("g1")}>
        delete group
      </button>
      <button type="button" onClick={() => void m.createTask("g1", { title: "two" })}>
        create task
      </button>
      <button type="button" onClick={() => void m.updateTask("g1-0", { done: true })}>
        update task
      </button>
      <button type="button" onClick={() => void m.deleteTask("g1-0")}>
        delete task
      </button>
    </div>
  );
};

const renderProbe = (ui: React.ReactNode) => {
  const { factory, sources } = captureEventSources();
  const rendered = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, sources };
};

describe("project tasks state", () => {
  it("refetches the list and the project index on task.changed for that project only", async () => {
    let listFetches = 0;
    let indexFetches = 0;
    server.use(
      http.get("*/api/projects/p1/tasks", () => {
        listFetches += 1;
        return HttpResponse.json({ groups: [group("g1", "Now", ["one"])] });
      }),
      http.get("*/api/projects", () => {
        indexFetches += 1;
        return HttpResponse.json({
          projects: [
            {
              id: "p1",
              name: "Atlas",
              createdAt: "2026-08-16T10:00:00.000Z",
              articleCount: 0,
              sessionCount: 0,
              openTaskCount: listFetches,
            },
          ],
        });
      }),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("groups:Now(1)")).toBeDefined();
    expect(await screen.findByText("projects:p1:1")).toBeDefined();

    act(() => {
      sources[0]?.emit({ type: "task.changed", projectId: "p2" });
    });
    await flushAsync();
    expect(listFetches).toBe(1);
    expect(indexFetches).toBe(2);

    server.use(
      http.get("*/api/projects/p1/tasks", () => {
        listFetches += 1;
        return HttpResponse.json({ groups: [group("g1", "Now", ["one", "two"])] });
      }),
    );
    act(() => {
      sources[0]?.emit({ type: "task.changed", projectId: "p1" });
    });
    expect(await screen.findByText("groups:Now(2)")).toBeDefined();
    expect(await screen.findByText("projects:p1:2")).toBeDefined();
  });

  it("re-syncs every list on reconnect", async () => {
    server.use(
      http.get("*/api/projects/p1/tasks", () =>
        HttpResponse.json({ groups: [group("g1", "Now", ["one"])] }),
      ),
      http.get("*/api/projects", () => HttpResponse.json({ projects: [] })),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("groups:Now(1)")).toBeDefined();

    server.use(http.get("*/api/projects/p1/tasks", () => HttpResponse.json({ groups: [] })));
    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());
    expect(await screen.findByText("groups:")).toBeDefined();
  });

  it("issues each mutation and refetches the list afterwards", async () => {
    const calls: string[] = [];
    let listFetches = 0;
    const record = (label: string) => () => {
      calls.push(label);
      return HttpResponse.json({}, { status: 200 });
    };
    server.use(
      http.get("*/api/projects/p1/tasks", () => {
        listFetches += 1;
        return HttpResponse.json({ groups: [group("g1", "Now", ["one"])] });
      }),
      http.get("*/api/projects", () => HttpResponse.json({ projects: [] })),
      http.post("*/api/projects/p1/task-groups", record("create-group")),
      http.put("*/api/projects/p1/task-groups", record("reorder-groups")),
      http.patch("*/api/projects/p1/task-groups/g1", record("rename-group")),
      http.delete("*/api/projects/p1/task-groups/g1", record("delete-group")),
      http.post("*/api/projects/p1/task-groups/g1/tasks", record("create-task")),
      http.patch("*/api/projects/p1/tasks/g1-0", record("update-task")),
      http.delete("*/api/projects/p1/tasks/g1-0", record("delete-task")),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("groups:Now(1)")).toBeDefined();
    const user = userEvent.setup();
    for (const label of [
      "create group",
      "rename group",
      "reorder groups",
      "delete group",
      "create task",
      "update task",
      "delete task",
    ]) {
      await user.click(screen.getByRole("button", { name: label }));
      await flushAsync();
    }
    expect(calls).toEqual([
      "create-group",
      "rename-group",
      "reorder-groups",
      "delete-group",
      "create-task",
      "update-task",
      "delete-task",
    ]);
    expect(listFetches).toBe(8);
  });
});
