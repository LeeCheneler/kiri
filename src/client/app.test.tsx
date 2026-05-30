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
    // The home page's loading state is what we'll see synchronously before the
    // mocked fetch resolves; either way, the "Page not found" copy must
    // not appear when the route matched.
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

  it("renders 'page not found' for an unmatched path", async () => {
    renderAt("/totally-unknown");
    expect(screen.getByText(/page not found/i)).toBeDefined();
    await flushAsync();
  });

  it("mounts the toast container so completion notifications surface app-wide", async () => {
    renderAt("/");
    // The container exposes itself as a named polite live region; presence
    // is enough — toast behaviour is covered in toast-container.test.tsx.
    expect(screen.getByRole("status", { name: /notifications/i }).getAttribute("aria-live")).toBe(
      "polite",
    );
    await flushAsync();
  });

  it("shows the Recently Published rail on the home route", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: /recently published/i })).toBeDefined();
    await flushAsync();
  });

  it("omits the Recently Published rail on the workflow route", async () => {
    renderAt("/workflows/example");
    await flushAsync();
    expect(screen.queryByRole("heading", { name: /recently published/i })).toBeNull();
  });

  it("swaps the right rail for the article TOC on the article route", async () => {
    // Article body carries a section anchor so the TOC has an entry to show.
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Demo",
          contentMd: "# A section\n\nbody\n",
          createdAt: new Date().toISOString(),
          workflowName: "wf",
          heading: "A section",
          gitSha: null,
          gitDirty: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderAt("/runs/run-1/published/demo");

    // The article TOC marginalia is present; the cross-run Recently
    // Published shortlist is not.
    expect(await screen.findByRole("heading", { name: /in this article/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /recently published/i })).toBeNull();
    await flushAsync();
  });

  it("shows the design-system TOC in the right rail on the design-system route", async () => {
    renderAt("/dev/design-system");
    expect(await screen.findByRole("navigation", { name: "On this page" })).toBeDefined();
    await flushAsync();
  });
});
