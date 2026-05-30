import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { WorkflowStats } from "./workflow-stats.tsx";

// Minimal run-window entry; only status, timestamps, and articles are read.
const entry = (over: Record<string, unknown> = {}) => ({
  id: "r",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  articles: [],
  ...over,
});

const serveRuns = (runs: unknown[]) =>
  server.use(http.get("*/api/runs", () => HttpResponse.json({ runs, nextCursor: null })));

const renderStats = (workflowName = "deploy") =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WorkflowStats workflowName={workflowName} />
    </QueryClientProvider>,
  );

describe("<WorkflowStats>", () => {
  it("summarises the recent run window", async () => {
    serveRuns([
      entry({ status: "ok", articles: [{}, {}] }),
      entry({ status: "ok", articles: [{}, {}, {}] }),
      entry({ status: "ok", articles: [{}, {}] }),
      entry({ status: "failed", articles: [] }),
    ]);
    renderStats();
    // 4 runs, 3 ok, 1 failed, 7 articles.
    expect(await screen.findByText("4")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
  });

  it("charts the window as a sparkline", async () => {
    serveRuns([entry(), entry()]);
    renderStats();
    expect(await screen.findByRole("img", { name: /durations/i })).toBeDefined();
  });

  it("shows an empty state when there are no runs", async () => {
    serveRuns([]);
    renderStats();
    expect(await screen.findByText(/no runs to chart/i)).toBeDefined();
  });

  it("shows a loading state until the window resolves", () => {
    server.use(http.get("*/api/runs", () => new Promise(() => {})));
    renderStats();
    expect(screen.getByText(/loading run stats/i)).toBeDefined();
  });

  it("shows an error when the window fails to load", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderStats();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
  });
});
