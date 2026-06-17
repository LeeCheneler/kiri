import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../tests/setup/flush-async.ts";
import { server } from "../../tests/setup/msw.ts";
import { mockReactVega } from "../../tests/setup/react-vega-mock.tsx";
import { App } from "./app.tsx";

// The design-system route renders a Markdown demo with a lazy vega chart;
// mock it so rendering that route doesn't pull in the charting bundle.
mockReactVega();

const renderAt = (path: string) => {
  const { hook } = memoryLocation({ path });
  const { factory } = captureEventSources();
  return render(
    <Router hook={hook}>
      <App liveEventsFactory={factory} />
    </Router>,
  );
};

describe("<App>", () => {
  it("renders the kiri wordmark from the page shell", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: /^kiri$/i })).toBeDefined();
    await flushAsync();
  });

  it("routes / to the home page", async () => {
    renderAt("/");
    // The activity view tabs are unique to the home page; their presence
    // confirms the route matched rather than falling through to not-found.
    expect(screen.getByRole("tab", { name: /^all$/i })).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /workflows to the workflow catalog", async () => {
    renderAt("/workflows");
    // The catalogue's filter box is unique to this route; its presence confirms
    // the catalog rendered rather than falling through to not-found.
    expect(screen.getByPlaceholderText(/filter workflows/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /workflows/:name to the workflow page", async () => {
    renderAt("/workflows/example");
    expect(screen.getByText(/loading workflow/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /runs/:id to the run page", async () => {
    // Stall the run fetch so the page stays in its loading state for the
    // assertion; the shell around it still renders.
    server.use(http.get("*/api/runs/:id", () => new Promise<Response>(() => {})));
    renderAt("/runs/abc");
    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /sessions/:id to the session chat page", async () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    renderAt("/sessions/abc");
    expect(screen.getByText(/loading session/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("renders 'page not found' for an unmatched path", async () => {
    renderAt("/totally-unknown");
    expect(screen.getByText(/page not found/i)).toBeDefined();
    await flushAsync();
  });

  it("shows the article TOC in the right rail on the article route", async () => {
    // Article body carries a `##` section so the TOC has an entry to show.
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Demo",
          contentMd: "# Headline\n\n## A section\n\nbody\n",
          createdAt: new Date().toISOString(),
          workflowName: "wf",
          heading: "Headline",
          gitSha: null,
          gitDirty: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderAt("/runs/run-1/published/demo");

    // Wait for the markdown body's section heading to land first: the right-rail
    // TOC is derived from those section anchors once they're in the document, so
    // asserting it before the body has rendered races that collection (flaky on a
    // slower CI runner). Both lookups get a wide window for a cold render.
    await screen.findByRole("heading", { level: 2, name: /a section/i }, { timeout: 5000 });
    expect(
      await screen.findByRole("heading", { name: /in this article/i }, { timeout: 5000 }),
    ).toBeDefined();
    await flushAsync();
  });

  it("shows the design-system TOC in the right rail on the design-system route", async () => {
    renderAt("/dev/design-system");
    expect(
      await screen.findByRole("navigation", { name: "On this page" }, { timeout: 5000 }),
    ).toBeDefined();
    await flushAsync();
  });
});
