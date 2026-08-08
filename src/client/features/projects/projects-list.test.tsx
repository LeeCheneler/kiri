import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ProjectsList } from "./projects-list.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const summary = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  createdAt: "2026-08-07T10:00:00.000Z",
  articleCount: 0,
  sessionCount: 0,
  ...over,
});

const serveProjects = (projects: unknown[]) =>
  server.use(http.get("*/api/projects", () => HttpResponse.json({ projects })));

const renderList = () => {
  const memory = memoryLocation({ path: "/projects", record: true });
  render(
    <Router hook={memory.hook}>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectsList now={NOW} />
      </QueryClientProvider>
    </Router>,
  );
  return { history: memory.history };
};

describe("<ProjectsList>", () => {
  it("lists each project as a link with its counts", async () => {
    serveProjects([
      summary("p1", "Research", { articleCount: 2, sessionCount: 1 }),
      summary("p2", "Gardening"),
    ]);
    renderList();

    const link = await screen.findByRole("link", { name: "Research" });
    expect(link.getAttribute("href")).toBe("/projects/p1");
    expect(screen.getByText("2 articles")).toBeDefined();
    expect(screen.getByText("1 session")).toBeDefined();
    expect(screen.getByRole("link", { name: "Gardening" })).toBeDefined();
  });

  it("explains the feature when no projects exist", async () => {
    serveProjects([]);
    renderList();

    expect(await screen.findByText(/no projects yet/i)).toBeDefined();
  });

  it("surfaces an error when the index fails to load", async () => {
    server.use(http.get("*/api/projects", () => new HttpResponse("boom", { status: 500 })));
    renderList();

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("creates a project and navigates to its page", async () => {
    let posted: unknown = null;
    serveProjects([]);
    server.use(
      http.post("*/api/projects", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { project: { id: "p1", name: "Research", createdAt: "2026-08-07T10:00:00.000Z" } },
          { status: 201 },
        );
      }),
    );
    const { history } = renderList();

    await userEvent.type(await screen.findByPlaceholderText("New project name…"), "  Research  ");
    await userEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/projects/p1"));
    expect(posted).toEqual({ name: "Research" });
  });

  it("ignores a blank create", async () => {
    let posted = false;
    serveProjects([]);
    server.use(
      http.post("*/api/projects", () => {
        posted = true;
        return HttpResponse.json({ project: summary("p1", "x") }, { status: 201 });
      }),
    );
    renderList();

    await userEvent.click(await screen.findByRole("button", { name: "create" }));

    expect(posted).toBe(false);
  });

  it("surfaces a failed create inline and stays on the page", async () => {
    serveProjects([]);
    server.use(http.post("*/api/projects", () => new HttpResponse("boom", { status: 500 })));
    const { history } = renderList();

    await userEvent.type(await screen.findByPlaceholderText("New project name…"), "Research");
    await userEvent.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(history[history.length - 1]).toBe("/projects");
  });
});
