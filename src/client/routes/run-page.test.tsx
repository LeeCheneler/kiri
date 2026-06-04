import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("renders the run header, summary, and breadcrumb when the run loads", async () => {
    // The registry carries the run's workflow so the re-run action can resolve
    // its declared inputs.
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "kiri-self-review", steps: [{ use: "check" }] }]),
      ),
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({
          run: {
            id: params.id,
            workflowName: "kiri-self-review",
            status: "ok",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: "2026-05-09T12:00:42.000Z",
            error: null,
            summary: "All checks passed.",
            definitionSnapshot: { name: "kiri-self-review", steps: [{ use: "check" }] },
            gitSha: null,
            gitDirty: null,
            inputs: null,
            isInterrupted: false,
            articles: [],
            recommendationsCount: 0,
            recommendations: [],
          },
          steps: [
            {
              id: "s0",
              runId: params.id,
              index: 0,
              kind: "use",
              status: "ok",
              startedAt: "2026-05-09T12:00:00.000Z",
              finishedAt: "2026-05-09T12:00:42.000Z",
              output: null,
              error: null,
              traces: { stdout: "ok\n", stderr: "", durationMs: 42000 },
              isSummary: false,
              isPublish: false,
            },
          ],
        }),
      ),
    );

    renderRun("abcd1234efgh");

    // Header: the workflow eyebrow above the run's short id as the heading.
    expect(await screen.findByText("kiri-self-review · Run")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "abcd1234" })).toBeDefined();
    // The summary renders below the header once the run has produced one.
    expect(screen.getByText("All checks passed.")).toBeDefined();
    // The phases render: the Steps group lists the declared step.
    expect(screen.getByText("check")).toBeDefined();
    // A terminal run carries its re-run and delete controls in the header.
    expect(screen.getByRole("button", { name: /run again/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
    // The breadcrumb still threads Activity → workflow → the run's short id;
    // scope to it so the short id isn't confused with the heading.
    const breadcrumb = within(screen.getByRole("navigation", { name: /breadcrumb/i }));
    expect(breadcrumb.getByRole("link", { name: /^activity$/i }).getAttribute("href")).toBe("/");
    expect(breadcrumb.getByRole("link", { name: /kiri-self-review/i }).getAttribute("href")).toBe(
      "/workflows/kiri-self-review",
    );
    expect(breadcrumb.getByText("abcd1234").getAttribute("aria-current")).toBe("page");
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
