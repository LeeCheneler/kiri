import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ProjectTasks } from "./project-tasks.tsx";

const task = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  groupId: "g1",
  title,
  done: false,
  note: null,
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt: "2026-08-16T10:00:00.000Z",
  ...over,
});

const group = (id: string, name: string, tasks: unknown[] = []) => ({
  id,
  projectId: "p1",
  name,
  position: 0,
  hidden: false,
  createdAt: "2026-08-16T10:00:00.000Z",
  tasks,
});

const serveTasks = (groups: unknown[]) =>
  server.use(http.get("*/api/projects/p1/tasks", () => HttpResponse.json({ groups })));

const renderTasks = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ProjectTasks projectId="p1" />
    </QueryClientProvider>,
  );

describe("<ProjectTasks>", () => {
  it("shows the empty state with the creation actions when there are no groups", async () => {
    serveTasks([]);
    renderTasks();
    expect(await screen.findByText(/no tasks yet/)).toBeDefined();
    expect(screen.getByRole("button", { name: "+ New group" })).toBeDefined();
  });

  it("renders each group with its tasks as checkboxes, notes, and open counts", async () => {
    serveTasks([
      group("g1", "Now", [
        task("t1", "Write docs", { note: "blocked on review" }),
        task("t2", "Ship", { done: true }),
      ]),
      group("g2", "Later"),
    ]);
    renderTasks();

    const now = await screen.findByRole("region", { name: "Now" });
    expect(within(now).getByRole("checkbox", { name: "Write docs" })).toHaveProperty(
      "checked",
      false,
    );
    expect(within(now).getByRole("checkbox", { name: "Ship" })).toHaveProperty("checked", true);
    expect(within(now).getByText("blocked on review")).toBeDefined();
    expect(within(now).getByText("1 open")).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: "Later" })).getByText("no tasks"),
    ).toBeDefined();
  });

  it("reads a fully ticked group as all done", async () => {
    serveTasks([group("g1", "Now", [task("t1", "Ship", { done: true })])]);
    renderTasks();
    expect(await screen.findByText("all done")).toBeDefined();
  });

  it("toggles completion through the checkbox and refetches", async () => {
    let patched: unknown = null;
    serveTasks([group("g1", "Now", [task("t1", "Write docs")])]);
    server.use(
      http.patch("*/api/projects/p1/tasks/t1", async ({ request }) => {
        patched = await request.json();
        serveTasks([group("g1", "Now", [task("t1", "Write docs", { done: true })])]);
        return HttpResponse.json({ task: task("t1", "Write docs", { done: true }) });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Write docs" }));
    expect(patched).toEqual({ done: true });
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Write docs" })).toHaveProperty("checked", true),
    );
  });

  it("surfaces a failed toggle inline", async () => {
    serveTasks([group("g1", "Now", [task("t1", "Write docs")])]);
    server.use(
      http.patch("*/api/projects/p1/tasks/t1", () =>
        HttpResponse.json({ error: "nope" }, { status: 500 }),
      ),
    );
    renderTasks();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Write docs" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
  });

  it("adds a task to a group from its add action", async () => {
    let posted: unknown = null;
    serveTasks([group("g1", "Now"), group("g2", "Later")]);
    server.use(
      http.post("*/api/projects/p1/task-groups/g2/tasks", async ({ request }) => {
        posted = await request.json();
        serveTasks([group("g1", "Now"), group("g2", "Later", [task("t1", "Write docs")])]);
        return HttpResponse.json({ task: task("t1", "Write docs") }, { status: 201 });
      }),
    );
    renderTasks();

    const later = await screen.findByRole("region", { name: "Later" });
    await userEvent.click(within(later).getByRole("button", { name: "add task" }));
    const dialog = await screen.findByRole("dialog", { name: "Add task" });
    await userEvent.type(within(dialog).getByLabelText("Note"), "with examples");
    await userEvent.type(within(dialog).getByLabelText("Title"), "Write docs{Enter}");

    expect(posted).toEqual({ title: "Write docs", note: "with examples" });
    expect(await screen.findByRole("checkbox", { name: "Write docs" })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the add-task dialog open with the error when the add fails", async () => {
    let posts = 0;
    serveTasks([group("g1", "Now")]);
    server.use(
      http.post("*/api/projects/p1/task-groups/g1/tasks", () => {
        posts += 1;
        return HttpResponse.json({ error: "boom" }, { status: 500 });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "add task" }));
    const dialog = await screen.findByRole("dialog");
    // A blank title can't be submitted at all.
    await userEvent.keyboard("{Enter}");
    expect(posts).toBe(0);
    await userEvent.type(within(dialog).getByLabelText("Title"), "Write docs{Enter}");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("boom");
    expect(posts).toBe(1);
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("creates a group from the new-group dialog, reporting a clash inline", async () => {
    const names: string[] = [];
    serveTasks([]);
    server.use(
      http.post("*/api/projects/p1/task-groups", async ({ request }) => {
        const { name } = (await request.json()) as { name: string };
        names.push(name);
        if (name === "Taken") return HttpResponse.json({ error: "clash" }, { status: 409 });
        serveTasks([group("g1", name)]);
        return HttpResponse.json({ group: group("g1", name) }, { status: 201 });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "+ New group" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Name");
    await userEvent.keyboard("{Enter}");
    expect(names).toEqual([]);
    await userEvent.type(field, "Taken{Enter}");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("clash");
    await userEvent.clear(field);
    await userEvent.type(field, "Now");
    await userEvent.click(within(dialog).getByRole("button", { name: "create" }));
    expect(await screen.findByRole("region", { name: "Now" })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(names).toEqual(["Taken", "Now"]);
  });

  it("edits a task's title and note through the edit modal", async () => {
    let patched: unknown = null;
    serveTasks([group("g1", "Now", [task("t1", "Write docs")])]);
    server.use(
      http.patch("*/api/projects/p1/tasks/t1", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ task: task("t1", "Write the docs") });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "edit" }));
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Write the docs");
    await userEvent.type(within(dialog).getByLabelText("Note"), "with examples");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));

    expect(patched).toEqual({ title: "Write the docs", note: "with examples" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("deletes a task from the edit modal and reports a failed save inline", async () => {
    let deleted = false;
    serveTasks([group("g1", "Now", [task("t1", "Write docs")])]);
    server.use(
      http.patch("*/api/projects/p1/tasks/t1", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
      http.delete("*/api/projects/p1/tasks/t1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "edit" }));
    let dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("boom");
    await userEvent.click(within(dialog).getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "edit" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "delete task" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renames a group through its modal, reporting a clash inline", async () => {
    const names: string[] = [];
    serveTasks([group("g1", "Now")]);
    server.use(
      http.patch("*/api/projects/p1/task-groups/g1", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        names.push(body.name);
        if (body.name === "Later") return HttpResponse.json({ error: "clash" }, { status: 409 });
        return HttpResponse.json({ group: group("g1", body.name) });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "rename group" }));
    let dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "Later{Enter}");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("clash");
    await userEvent.clear(field);
    await userEvent.type(field, "Today{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(names).toEqual(["Later", "Today"]);

    // A blank name can't be submitted.
    await userEvent.click(screen.getByRole("button", { name: "rename group" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.keyboard("{Enter}");
    expect(names).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "cancel" }));
  });

  it("deletes a group behind a confirm, surfacing a failure inline", async () => {
    let attempts = 0;
    serveTasks([group("g1", "Now", [task("t1", "one")])]);
    server.use(
      http.delete("*/api/projects/p1/task-groups/g1", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ error: "locked" }, { status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    renderTasks();

    await userEvent.click(await screen.findByRole("button", { name: "delete group" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("its task");
    await userEvent.click(within(dialog).getByRole("button", { name: "cancel" }));
    expect(attempts).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "delete group" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain("locked");

    serveTasks([]);
    await userEvent.click(screen.getByRole("button", { name: "delete group" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "delete" }));
    expect(await screen.findByText(/no tasks yet/)).toBeDefined();
  });

  it("collapses hidden groups behind a toggle and lets a group be hidden or unhidden", async () => {
    const patches: unknown[] = [];
    const hiddenState: Record<string, boolean> = { g1: false, g2: true };
    const serveState = () =>
      serveTasks([
        { ...group("g1", "Now"), hidden: hiddenState.g1 },
        { ...group("g2", "Old"), hidden: hiddenState.g2 },
      ]);
    serveState();
    server.use(
      http.patch("*/api/projects/p1/task-groups/:groupId", async ({ request, params }) => {
        const body = (await request.json()) as { hidden: boolean };
        patches.push([params.groupId, body]);
        hiddenState[String(params.groupId)] = body.hidden;
        serveState();
        return HttpResponse.json({ group: group(String(params.groupId), "x") });
      }),
    );
    renderTasks();

    expect(await screen.findByRole("region", { name: "Now" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Old" })).toBeNull();

    const toggle = screen.getByRole("button", { name: "show 1 hidden group" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    const old = await screen.findByRole("region", { name: "Old" });
    expect(screen.getByRole("button", { name: "hide hidden groups" })).toBeDefined();

    await userEvent.click(within(old).getByRole("button", { name: "unhide group" }));
    await waitFor(() => expect(patches).toEqual([["g2", { hidden: false }]]));
    await waitFor(() => expect(screen.queryByRole("button", { name: /hidden group/ })).toBeNull());

    const now = screen.getByRole("region", { name: "Now" });
    await userEvent.click(within(now).getByRole("button", { name: "hide group" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    // The toggle was left expanded, so the freshly hidden group shows in the
    // hidden section straight away; collapsing hides it.
    expect(await screen.findByRole("button", { name: "hide hidden groups" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Now" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "hide hidden groups" }));
    expect(screen.queryByRole("region", { name: "Now" })).toBeNull();
    expect(screen.getByRole("button", { name: "show 1 hidden group" })).toBeDefined();
  });

  it("surfaces a failed hide inline", async () => {
    serveTasks([group("g1", "Now")]);
    server.use(
      http.patch("*/api/projects/p1/task-groups/g1", () =>
        HttpResponse.json({ error: "nope" }, { status: 500 }),
      ),
    );
    renderTasks();
    await userEvent.click(await screen.findByRole("button", { name: "hide group" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
  });

  it("reports a failed load", async () => {
    server.use(
      http.get("*/api/projects/p1/tasks", () =>
        HttpResponse.json({ error: "down" }, { status: 500 }),
      ),
    );
    renderTasks();
    expect((await screen.findByRole("alert")).textContent).toContain("Failed to load tasks");
  });
});
