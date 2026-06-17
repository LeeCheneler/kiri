import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { WorkflowCatalog } from "./workflow-catalog.tsx";

const NOW = new Date("2026-05-09T12:03:00.000Z");

const wf = (name: string, over: Record<string, unknown> = {}) => ({ name, steps: [], ...over });

const feedRun = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  workflowName: "x",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "x", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  ...over,
});

const renderCatalog = () =>
  render(
    <Router hook={memoryLocation({ path: "/workflows" }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <WorkflowCatalog now={NOW} />
      </QueryClientProvider>
    </Router>,
  );

describe("<WorkflowCatalog>", () => {
  it("surfaces an error when the workflow registry fails to load", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));
    renderCatalog();
    expect((await screen.findByRole("alert")).textContent).toMatch(/failed to load workflows/i);
  });

  it("groups workflows and shows each one's last-run status", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          wf("Greet", { group: "Examples", description: "Greets you" }),
          wf("System Report", { group: "Diagnostics" }),
        ]),
      ),
      http.get("*/api/runs", ({ request }) => {
        const workflow = new URL(request.url).searchParams.get("workflow");
        if (workflow === "Greet") {
          return HttpResponse.json({
            runs: [feedRun({ workflowName: "Greet", status: "ok" })],
            nextCursor: null,
          });
        }
        return HttpResponse.json({ runs: [], nextCursor: null });
      }),
    );
    renderCatalog();

    expect(await screen.findByRole("link", { name: "Greet" })).toBeDefined();
    expect(screen.getByText("Examples")).toBeDefined();
    expect(screen.getByText("Diagnostics")).toBeDefined();
    expect(screen.getByRole("link", { name: "Greet" }).getAttribute("href")).toBe(
      "/workflows/Greet",
    );
    // Greet has a run; System Report has never run.
    expect(await screen.findByText("ok")).toBeDefined();
    expect(screen.getByText("never run")).toBeDefined();
  });

  it("filters the catalogue by the search box", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([wf("Greet", { group: "Examples" }), wf("System Report")]),
      ),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })),
    );
    const user = userEvent.setup();
    renderCatalog();
    await screen.findByRole("link", { name: "Greet" });

    await user.type(screen.getByPlaceholderText(/filter workflows/i), "greet");

    expect(screen.getByRole("link", { name: "Greet" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "System Report" })).toBeNull();
  });

  it("shows an empty state when there are no workflows", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([])));
    renderCatalog();

    expect(await screen.findByText(/no workflows yet/i)).toBeDefined();
  });

  it("shows a no-match state when the filter excludes every workflow", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([wf("Greet")])),
      http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })),
    );
    const user = userEvent.setup();
    renderCatalog();
    await screen.findByRole("link", { name: "Greet" });

    await user.type(screen.getByPlaceholderText(/filter workflows/i), "zzz-no-such-workflow");

    expect(screen.getByText(/no workflows match/i)).toBeDefined();
  });
});
