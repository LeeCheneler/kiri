import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../tests/setup/msw.ts";
import { Dashboard } from "./dashboard.tsx";

afterEach(() => cleanup());

const renderDashboard = () => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <Dashboard />
    </Router>,
  );
};

const stubRun = (
  overrides: Partial<{ id: string; workflowName: string; status: string }> = {},
) => ({
  id: overrides.id ?? "run-1",
  workflowName: overrides.workflowName ?? "kiri-self-review",
  status: overrides.status ?? "ok",
  trigger: "manual",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  definitionSnapshot: { name: overrides.workflowName ?? "kiri-self-review", steps: [] },
  isOrphan: false,
});

describe("<Dashboard>", () => {
  it("shows a loading message while runs are being fetched", () => {
    renderDashboard();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("renders an empty-state message when there are no runs", async () => {
    renderDashboard();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("renders each run as a link to its detail page", async () => {
    server.use(
      http.get("*/api/runs", () =>
        HttpResponse.json([
          stubRun({ id: "abc", workflowName: "alpha" }),
          stubRun({ id: "def", workflowName: "beta", status: "failed" }),
        ]),
      ),
    );
    renderDashboard();

    const alpha = await screen.findByRole("link", { name: /alpha/i });
    expect(alpha.getAttribute("href")).toBe("/runs/abc");

    const beta = await screen.findByRole("link", { name: /beta/i });
    expect(beta.getAttribute("href")).toBe("/runs/def");
  });

  it("surfaces fetch failures via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });
});
