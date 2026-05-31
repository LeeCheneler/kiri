import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "../state/query-client.ts";
import { RunContent } from "./run-page.tsx";

const renderRun = (id: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}` });
  const { factory } = captureEventSources();
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Router hook={hook}>
          <RunContent params={{ id }} />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
};

describe("<RunPage>", () => {
  it("shows a loading message while the run is being fetched", () => {
    // Stall the fetch indefinitely so the loading state stays visible
    // for the assertion. Default MSW handlers don't cover this path, so
    // without a pending responder the request would land as unhandled.
    server.use(http.get("*/api/runs/:id", () => new Promise<Response>(() => {})));
    renderRun("abc");
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("renders the run's breadcrumb trail when the run loads", async () => {
    server.use(
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({
          run: {
            id: params.id,
            workflowName: "kiri-self-review",
            status: "ok",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: "2026-05-09T12:00:01.000Z",
            error: null,
            definitionSnapshot: { name: "kiri-self-review", steps: [] },
            isInterrupted: false,
            articles: [],
          },
          steps: [],
        }),
      ),
    );

    renderRun("abcd1234efgh");

    // The trail runs Activity → workflow → the run's short id.
    const activity = await screen.findByRole("link", { name: /^activity$/i });
    expect(activity.getAttribute("href")).toBe("/");
    const workflow = screen.getByRole("link", { name: /kiri-self-review/i });
    expect(workflow.getAttribute("href")).toBe("/workflows/kiri-self-review");
    expect(screen.getByText("abcd1234").getAttribute("aria-current")).toBe("page");
  });

  it("renders a not-found view when the API returns 404", async () => {
    server.use(
      http.get("*/api/runs/:id", () =>
        HttpResponse.json({ error: 'run "missing" not found' }, { status: 404 }),
      ),
    );

    renderRun("missing");

    expect(await screen.findByRole("heading", { name: /run not found/i })).toBeDefined();
    expect(screen.getByText("missing")).toBeDefined();
    expect(screen.getByRole("link", { name: /^activity$/i }).getAttribute("href")).toBe("/");
  });

  it("renders a generic error view on non-404 failures", async () => {
    server.use(http.get("*/api/runs/:id", () => new HttpResponse("boom", { status: 500 })));

    renderRun("abc");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load run/i);
  });
});
