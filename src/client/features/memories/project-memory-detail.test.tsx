import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ProjectMemoryDetail } from "./project-memory-detail.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const PATH = "/projects/p1/memories/deploy-window";

const detail = (over: Record<string, unknown> = {}) => ({
  name: "deploy-window",
  description: "Deploys land on Tuesdays.",
  contentMd: "Ship on Tuesdays.",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
  ...over,
});

const serveMemory = (memory: unknown) =>
  server.use(
    http.get("*/api/projects/:id/memories/:name", () => HttpResponse.json({ memory })),
    http.get("*/api/projects/:id", () =>
      HttpResponse.json({
        project: { id: "p1", name: "Research", createdAt: "2026-08-07T10:00:00.000Z" },
        articles: [],
        memories: [],
        sessions: [],
      }),
    ),
  );

const renderDetail = () => {
  const location = memoryLocation({ path: PATH, record: true });
  render(
    <Router hook={location.hook}>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectMemoryDetail projectId="p1" name="deploy-window" now={NOW} />
      </QueryClientProvider>
    </Router>,
  );
  return { history: location.history };
};

describe("<ProjectMemoryDetail>", () => {
  it("renders the memory under a breadcrumb naming its project", async () => {
    serveMemory(detail());
    renderDetail();

    expect(await screen.findByText("Deploys land on Tuesdays.")).toBeDefined();
    expect(screen.getByText("Ship on Tuesdays.")).toBeDefined();
    const crumb = await screen.findByRole("link", { name: "Research" });
    expect(crumb.getAttribute("href")).toBe("/projects/p1");
  });

  it("falls back to the short project id while the project is unknown", async () => {
    server.use(
      http.get("*/api/projects/:id/memories/:name", () => HttpResponse.json({ memory: detail() })),
      http.get("*/api/projects/:id", () => new HttpResponse("boom", { status: 500 })),
    );
    renderDetail();

    expect(await screen.findByRole("link", { name: "p1" })).toBeDefined();
  });

  it("renders not-found for a memory the project no longer has", async () => {
    server.use(
      http.get("*/api/projects/:id/memories/:name", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );
    renderDetail();

    expect(await screen.findByText("Memory not found")).toBeDefined();
  });

  it("edits in place, patching the project's memory", async () => {
    let patched: unknown = null;
    serveMemory(detail());
    server.use(
      http.patch("*/api/projects/:id/memories/:name", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ memory: detail({ description: "New summary." }) });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "edit memory" }));

    const summaryField = screen.getByLabelText("Summary");
    await userEvent.clear(summaryField);
    await userEvent.type(summaryField, "New summary.");
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(patched).toEqual({ description: "New summary.", contentMd: "Ship on Tuesdays." }),
    );
  });

  it("deletes behind a confirm and returns to the project", async () => {
    let deleted = false;
    serveMemory(detail());
    server.use(
      http.delete("*/api/projects/:id/memories/:name", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete memory" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/projects/p1"));
    expect(deleted).toBe(true);
  });
});
