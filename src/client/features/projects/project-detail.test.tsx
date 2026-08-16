import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ProjectDetail } from "./project-detail.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const detail = (over: Record<string, unknown> = {}) => ({
  project: {
    id: "p1",
    name: "Research",
    instructions: null,
    createdAt: "2026-08-07T10:00:00.000Z",
  },
  articles: [],
  memories: [],
  sessions: [],
  ...over,
});

const article = (slug: string, heading: string | null, name = "Doc") => ({
  slug,
  name,
  heading,
  createdAt: "2026-08-07T10:00:00.000Z",
});

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: null,
  preview: null,
  status: "idle",
  startedAt: "2026-08-07T10:00:00.000Z",
  ...over,
});

const serveProject = (body: unknown) =>
  server.use(http.get("*/api/projects/:id", () => HttpResponse.json(body as object)));

const renderDetail = () => {
  const memory = memoryLocation({ path: "/projects/p1", record: true });
  render(
    <Router hook={memory.hook}>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectDetail id="p1" now={NOW} />
      </QueryClientProvider>
    </Router>,
  );
  return { history: memory.history };
};

describe("<ProjectDetail>", () => {
  it("renders the article index with links into the corpus", async () => {
    serveProject(
      detail({
        articles: [article("corpus-doc", "Corpus Doc"), article("headless", null, "Headless")],
      }),
    );
    renderDetail();

    const link = await screen.findByRole("link", { name: "Corpus Doc" });
    expect(link.getAttribute("href")).toBe("/projects/p1/articles/corpus-doc");
    // Falls back to the article name when the body has no heading.
    expect(screen.getByRole("link", { name: "Headless" })).toBeDefined();
  });

  it("renders the memory index with links into the project's curation pages", async () => {
    serveProject(
      detail({
        memories: [
          {
            name: "deploy-window",
            description: "Deploys land on Tuesdays.",
            updatedAt: "2026-08-07T10:00:00.000Z",
          },
        ],
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Memories" }));

    const link = await screen.findByRole("link", { name: "deploy-window" });
    expect(link.getAttribute("href")).toBe("/projects/p1/memories/deploy-window");
    expect(screen.getByText("Deploys land on Tuesdays.")).toBeDefined();
  });

  it("renders the session index, leading with title then preview then id", async () => {
    serveProject(
      detail({
        sessions: [
          session("aaaabbbb-1", { title: "Titled", status: "running" }),
          session("ccccdddd-2", { preview: "first message" }),
          session("eeeeffff-3"),
        ],
      }),
    );
    renderDetail();

    expect(await screen.findByRole("link", { name: "Titled" })).toBeDefined();
    expect(screen.getByRole("link", { name: "first message" })).toBeDefined();
    const byId = screen.getByRole("link", { name: "eeeeffff" });
    expect(byId.getAttribute("href")).toBe("/sessions/eeeeffff-3");
    // A running turn reads as "working" in the shared status vocabulary.
    expect(screen.getByText("working")).toBeDefined();
  });

  it("explains every index when the container is empty", async () => {
    serveProject(detail());
    renderDetail();

    expect(await screen.findByText(/no articles yet/i)).toBeDefined();
    expect(screen.getByText(/no sessions yet/i)).toBeDefined();
    await userEvent.click(screen.getByRole("tab", { name: "Memories" }));
    expect(screen.getByText(/no memories yet/i)).toBeDefined();
  });

  it("renders not-found for a project that no longer exists", async () => {
    server.use(
      http.get("*/api/projects/:id", () =>
        HttpResponse.json({ error: 'project "p1" not found' }, { status: 404 }),
      ),
    );
    renderDetail();

    expect(await screen.findByText("Project not found")).toBeDefined();
  });

  it("surfaces a non-404 load failure as an alert", async () => {
    server.use(http.get("*/api/projects/:id", () => new HttpResponse("boom", { status: 500 })));
    renderDetail();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Project not found")).toBeNull();
  });

  it("renames through the modal: prefills, patches, and closes", async () => {
    let patched: unknown = null;
    serveProject(detail());
    server.use(
      http.patch("*/api/projects/:id", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          project: { id: "p1", name: "Renamed", createdAt: "2026-08-07T10:00:00.000Z" },
        });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "rename project" }));

    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Name");
    expect((nameField as HTMLInputElement).value).toBe("Research");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));

    await waitFor(() => expect(patched).toEqual({ name: "Renamed" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renames on Enter in the name field", async () => {
    let patched: unknown = null;
    serveProject(detail());
    server.use(
      http.patch("*/api/projects/:id", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          project: { id: "p1", name: "Renamed", createdAt: "2026-08-07T10:00:00.000Z" },
        });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "rename project" }));

    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Renamed{Enter}");

    await waitFor(() => expect(patched).toEqual({ name: "Renamed" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancelling the rename modal keeps the stored name", async () => {
    serveProject(detail());
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "rename project" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Research" })).toBeDefined();
  });

  it("surfaces a failed rename inside the modal and stays open", async () => {
    serveProject(detail());
    server.use(http.patch("*/api/projects/:id", () => new HttpResponse("boom", { status: 500 })));
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "rename project" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));

    expect(await within(dialog).findByRole("alert")).toBeDefined();
    expect(within(dialog).getByLabelText("Name")).toBeDefined();
  });

  it("mounts the task list on its own tab", async () => {
    serveProject(detail());
    server.use(http.get("*/api/projects/p1/tasks", () => HttpResponse.json({ groups: [] })));
    renderDetail();

    expect(screen.queryByRole("button", { name: "+ New group" })).toBeNull();
    await userEvent.click(await screen.findByRole("tab", { name: "Tasks" }));
    expect(await screen.findByRole("button", { name: "+ New group" })).toBeDefined();
  });

  it("shows the project's instructions on their own tab", async () => {
    serveProject(
      detail({
        project: {
          id: "p1",
          name: "Research",
          instructions: "Cite every source.",
          createdAt: "2026-08-07T10:00:00.000Z",
        },
      }),
    );
    renderDetail();

    const tab = await screen.findByRole("tab", { name: "Instructions" });
    expect(screen.queryByText("Cite every source.")).toBeNull();
    await userEvent.click(tab);
    expect(screen.getByText("Cite every source.")).toBeDefined();
    expect(screen.queryByText(/no instructions yet/)).toBeNull();
  });

  it("shows an empty state when the project has no instructions", async () => {
    serveProject(detail());
    renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Instructions" }));

    expect(await screen.findByText(/no instructions yet/)).toBeDefined();
  });

  it("edits the instructions through the modal: prefills, patches, and closes", async () => {
    let patched: unknown = null;
    serveProject(
      detail({
        project: {
          id: "p1",
          name: "Research",
          instructions: "Cite every source.",
          createdAt: "2026-08-07T10:00:00.000Z",
        },
      }),
    );
    server.use(
      http.patch("*/api/projects/:id", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          project: {
            id: "p1",
            name: "Research",
            instructions: "Cite every source. Twice.",
            createdAt: "2026-08-07T10:00:00.000Z",
          },
        });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Instructions" }));
    await userEvent.click(screen.getByRole("button", { name: "edit instructions" }));

    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Instructions");
    expect((field as HTMLTextAreaElement).value).toBe("Cite every source.");
    await userEvent.clear(field);
    await userEvent.type(field, "Cite every source. Twice.");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));

    await waitFor(() => expect(patched).toEqual({ instructions: "Cite every source. Twice." }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancelling the instructions modal writes nothing", async () => {
    let patched = false;
    serveProject(detail());
    server.use(
      http.patch("*/api/projects/:id", () => {
        patched = true;
        return HttpResponse.json({ project: detail().project });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Instructions" }));
    await userEvent.click(screen.getByRole("button", { name: "edit instructions" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Instructions"), "Discarded.");
    await userEvent.click(within(dialog).getByRole("button", { name: "cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patched).toBe(false);
  });

  it("surfaces a failed instructions save inside the modal and stays open", async () => {
    serveProject(detail());
    server.use(http.patch("*/api/projects/:id", () => new HttpResponse("boom", { status: 500 })));
    renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Instructions" }));
    await userEvent.click(screen.getByRole("button", { name: "edit instructions" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "save" }));

    expect(await within(dialog).findByRole("alert")).toBeDefined();
    expect(within(dialog).getByLabelText("Instructions")).toBeDefined();
  });

  it("deletes behind a confirm that spells out the cascade", async () => {
    let deleted = false;
    serveProject(
      detail({ articles: [article("corpus-doc", "Corpus Doc")], sessions: [session("s1")] }),
    );
    server.use(
      http.delete("*/api/projects/:id", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete project" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 article, 0 memories and 1 session/)).toBeDefined();
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/projects"));
    expect(deleted).toBe(true);
  });

  it("dismissing the delete confirm leaves the project alone", async () => {
    let deleted = false;
    serveProject(detail());
    server.use(
      http.delete("*/api/projects/:id", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete project" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleted).toBe(false);
  });

  it("surfaces a failed delete inline and stays on the page", async () => {
    serveProject(detail());
    server.use(http.delete("*/api/projects/:id", () => new HttpResponse("boom", { status: 500 })));
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete project" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(history[history.length - 1]).toBe("/projects/p1");
  });

  it("treats deleting an already-deleted project as done and navigates home", async () => {
    serveProject(detail());
    server.use(
      http.delete("*/api/projects/:id", () =>
        HttpResponse.json({ error: "gone" }, { status: 404 }),
      ),
    );
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete project" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/projects"));
  });
});
