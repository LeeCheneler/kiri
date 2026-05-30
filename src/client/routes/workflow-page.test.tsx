import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { WorkflowContent } from "./workflow-page.tsx";

// The page resolves the workflow from the registry query; the skeleton
// renders its name while the detail features are rebuilt around it.
const renderWorkflow = (name: string, initialPath = `/workflows/${name}`) => {
  const memory = memoryLocation({ path: initialPath, record: true });
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <WorkflowContent params={{ name }} />
      </Router>
    </QueryClientProvider>,
  );
  return { ...ui, history: memory.history };
};

describe("<WorkflowPage>", () => {
  it("shows a loading message while the registry is being fetched", async () => {
    renderWorkflow("kiri-self-review");
    expect(screen.getByText(/loading workflow/i)).toBeDefined();
    await flushAsync();
  });

  it("renders the workflow name when it is in the registry", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          { name: "kiri-self-review", steps: [{ sh: "echo ok" }] },
          { name: "other", steps: [] },
        ]),
      ),
    );

    renderWorkflow("kiri-self-review");

    expect(
      await screen.findByRole("heading", { level: 2, name: /kiri-self-review/i }),
    ).toBeDefined();
    // The breadcrumb trail leads back to the activity feed.
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
    // The hero composes the run affordance.
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDefined();
    // The detail tabs are composed below.
    expect(screen.getByRole("tab", { name: "Schema" })).toBeDefined();
  });

  it("renders a not-found view when the registry has no workflow with that name", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "other", steps: [] }])),
    );

    renderWorkflow("missing");

    expect(await screen.findByRole("heading", { name: /workflow not found/i })).toBeDefined();
    expect(screen.getByText("missing")).toBeDefined();
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
  });

  it("renders a generic error view when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));

    renderWorkflow("kiri-self-review");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load workflow/i);
  });

  it("resolves a workflow whose name contains a slash from the percent-encoded URL", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "examples/recommendations", steps: [{ sh: "echo ok" }] }]),
      ),
    );

    // wouter passes the param value verbatim from the URL — slashes arrive
    // still percent-encoded because wouter uses `decodeURI`, which leaves
    // `%2F` alone. The page must decode before comparing against the API.
    const encoded = encodeURIComponent("examples/recommendations");
    renderWorkflow(encoded, `/workflows/${encoded}`);

    expect(
      await screen.findByRole("heading", { level: 2, name: /examples\/recommendations/i }),
    ).toBeDefined();
  });

  it("falls back to the raw param when the URL contains a malformed escape", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "alpha", steps: [] }])),
    );

    // `%E0` is an incomplete UTF-8 byte and makes decodeURIComponent throw.
    // The route must still render (not crash) — typically as not-found.
    const malformed = "alpha%E0";
    renderWorkflow(malformed, `/workflows/${malformed}`);

    expect(await screen.findByRole("heading", { name: /workflow not found/i })).toBeDefined();
    expect(screen.getByText(malformed)).toBeDefined();
  });
});
