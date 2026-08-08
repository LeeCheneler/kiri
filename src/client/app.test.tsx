import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../tests/setup/flush-async.ts";
import { mockMermaid } from "../../tests/setup/mermaid-mock.tsx";
import { server } from "../../tests/setup/msw.ts";
import { mockReactVega } from "../../tests/setup/react-vega-mock.tsx";
import { App } from "./app.tsx";

// The design-system route renders Markdown demos with a lazy vega chart and a
// lazy mermaid diagram; mock both so rendering that route doesn't pull in the
// charting / diagram bundles.
mockReactVega();
mockMermaid();

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

  it("routes /memories to the memory index", async () => {
    renderAt("/memories");
    // The index's filter box is unique to this route; its presence confirms
    // the list rendered rather than falling through to not-found.
    expect(screen.getByPlaceholderText(/filter memories/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /memories/:name to the memory page", async () => {
    // Stall the memory fetch so the page holds its loading state for the assertion.
    server.use(http.get("*/api/memories/:name", () => new Promise<Response>(() => {})));
    renderAt("/memories/prefers-bun");
    expect(screen.getByText(/loading memory/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /projects to the project index", async () => {
    renderAt("/projects");
    // The index's filter box is unique to this route; its presence confirms
    // the list rendered rather than falling through to not-found.
    expect(screen.getByPlaceholderText(/filter projects/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /projects/:id to the project page", async () => {
    // Stall the project fetch so the page holds its loading state for the assertion.
    server.use(http.get("*/api/projects/:id", () => new Promise<Response>(() => {})));
    renderAt("/projects/p1");
    expect(screen.getByText(/loading project/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /projects/:id/articles/:slug to the project article page", async () => {
    // Stall the article fetch so the page holds its loading state for the assertion.
    server.use(
      http.get("*/api/projects/:id/articles/:slug", () => new Promise<Response>(() => {})),
      http.get("*/api/projects/:id", () => new Promise<Response>(() => {})),
    );
    renderAt("/projects/p1/articles/corpus-doc");
    expect(screen.getByText(/loading article/i)).toBeDefined();
    expect(screen.queryByText(/page not found/i)).toBeNull();
    await flushAsync();
  });

  it("routes /mcp to the MCP page", async () => {
    // Stall the tools fetch so the page holds its loading state for the assertion.
    server.use(http.get("*/api/mcp/tools", () => new Promise<Response>(() => {})));
    renderAt("/mcp");
    expect(screen.getByText(/loading mcp servers/i)).toBeDefined();
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
      http.get("*/api/runs/:id/articles/:slug", ({ params }) =>
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

    renderAt("/runs/run-1/articles/demo");

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

  it("routes /sessions/:id/articles/:slug to the session article page with its TOC", async () => {
    // Article body carries a `##` section so the TOC has an entry to show.
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          sessionId: params.id,
          slug: params.slug,
          name: "Demo",
          contentMd: "# Headline\n\n## A section\n\nbody\n",
          createdAt: new Date().toISOString(),
          heading: "Headline",
        }),
      ),
    );

    renderAt("/sessions/session-1/articles/demo");

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
