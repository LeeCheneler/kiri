import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RunAside } from "./run-aside.tsx";

type RunOverrides = Record<string, unknown>;

const detail = (runOverrides: RunOverrides = {}) => ({
  run: {
    id: "run-1",
    workflowName: "wf",
    status: "ok",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: "2026-05-09T12:00:42.000Z",
    error: null,
    summary: null,
    definitionSnapshot: { name: "wf", steps: [] },
    gitSha: null,
    gitDirty: null,
    inputs: null,
    isInterrupted: false,
    articles: [],
    recommendationsCount: 0,
    recommendations: [],
    ...runOverrides,
  },
  steps: [],
});

const renderAside = () => {
  const { hook } = memoryLocation({ path: "/runs/run-1" });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <RunAside id="run-1" />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<RunAside>", () => {
  it("renders nothing once a run with no inputs and no articles loads", async () => {
    server.use(http.get("*/api/runs/:id", () => HttpResponse.json(detail())));
    renderAside();
    await flushAsync();

    expect(screen.queryByText("Inputs")).toBeNull();
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("lists the inputs the run was invoked with", async () => {
    server.use(
      http.get("*/api/runs/:id", () =>
        HttpResponse.json(detail({ inputs: { pr_number: "42", branch: "main" } })),
      ),
    );
    renderAside();

    expect(await screen.findByText("Inputs")).toBeDefined();
    expect(screen.getByText("pr_number")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("branch")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
  });

  it("links the run's published articles by their first heading, then title", async () => {
    server.use(
      http.get("*/api/runs/:id", () =>
        HttpResponse.json(
          detail({
            articles: [
              {
                name: "digest",
                title: "PR Digest",
                heading: "Summary",
                createdAt: "2026-05-09T12:00:40.000Z",
              },
              {
                name: "notes",
                title: "Release Notes",
                heading: null,
                createdAt: "2026-05-09T12:00:41.000Z",
              },
            ],
          }),
        ),
      ),
    );
    renderAside();

    expect(await screen.findByText("Published")).toBeDefined();
    // heading present → link reads the heading; absent → falls back to the title.
    const byHeading = screen.getByRole("link", { name: /summary/i });
    expect(byHeading.getAttribute("href")).toBe("/runs/run-1/published/digest");
    const byTitle = screen.getByRole("link", { name: /release notes/i });
    expect(byTitle.getAttribute("href")).toBe("/runs/run-1/published/notes");
  });
});
