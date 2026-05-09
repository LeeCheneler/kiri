import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { Dashboard } from "./dashboard.tsx";

afterEach(() => cleanup());

const renderDashboard = () => {
  const { hook } = memoryLocation({ path: "/" });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <Dashboard />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

describe("<Dashboard>", () => {
  it("renders the activity section heading", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: /activity/i })).toBeDefined();
  });

  it("shows a loading message while runs are being fetched", () => {
    renderDashboard();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("delegates rendering to the activity feed once runs load", async () => {
    renderDashboard();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("surfaces fetch failures via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });

  it("refetches the runs list when a run lifecycle event fires", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/runs", () => {
        calls++;
        return HttpResponse.json([
          {
            id: `r${calls}`,
            workflowName: `wf-${calls}`,
            status: "ok",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: "2026-05-09T12:00:01.000Z",
            error: null,
            definitionSnapshot: { name: `wf-${calls}`, steps: [] },
            isOrphan: false,
          },
        ]);
      }),
    );

    const { sources } = renderDashboard();
    await screen.findByText(/wf-1/);

    act(() => {
      sources[0]?.emit({ type: "run.started", id: "new" });
    });

    await screen.findByText(/wf-2/);
  });
});
