import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { WorkflowPage } from "./workflow-page.tsx";

afterEach(() => cleanup());

const renderWorkflow = (name: string, initialPath = `/workflows/${name}`) => {
  const memory = memoryLocation({ path: initialPath, record: true });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={memory.hook}>
      <LiveEventsProvider factory={factory}>
        <WorkflowPage params={{ name }} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, history: memory.history, sources };
};

describe("<WorkflowPage>", () => {
  it("shows a loading message while the registry is being fetched", async () => {
    renderWorkflow("kiri-self-review");
    expect(screen.getByText(/loading workflow/i)).toBeDefined();
    await flushAsync();
  });

  it("delegates to the detail view when the workflow is in the registry", async () => {
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
    expect(screen.getByRole("heading", { level: 3, name: /steps/i })).toBeDefined();
  });

  it("renders a not-found view when the registry has no workflow with that name", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "other", steps: [] }])),
    );

    renderWorkflow("missing");

    expect(await screen.findByRole("heading", { name: /workflow not found/i })).toBeDefined();
    expect(screen.getByText("missing")).toBeDefined();
    expect(screen.getByRole("link", { name: /all activity/i }).getAttribute("href")).toBe("/");
  });

  it("renders a generic error view when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));

    renderWorkflow("kiri-self-review");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load workflow/i);
  });

  it("triggers a run and navigates to the run detail immediately on accept", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "kiri-self-review", steps: [{ sh: "echo ok" }] }]),
      ),
      http.post("*/api/workflows/:name/runs", ({ params }) =>
        HttpResponse.json(
          { runId: `run-${String(params.name)}-fresh`, status: "running" },
          { status: 202 },
        ),
      ),
    );

    const { history } = renderWorkflow("kiri-self-review");

    fireEvent.click(await screen.findByRole("button", { name: /^run/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-kiri-self-review-fresh");
    });
  });

  it("refetches when the matching workflow is updated", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json([{ name: "alpha", steps: [{ sh: `echo v${calls}` }] }]);
      }),
    );

    const { sources } = renderWorkflow("alpha");
    await screen.findByText(/sh: echo v1/);

    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "alpha" });
    });

    await screen.findByText(/sh: echo v2/);
  });

  it("ignores workflow events for other names", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json([{ name: "alpha", steps: [{ sh: `echo v${calls}` }] }]);
      }),
    );

    const { sources } = renderWorkflow("alpha");
    await screen.findByText(/sh: echo v1/);

    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "beta" });
      sources[0]?.emit({ type: "workflow.removed", name: "beta" });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText(/sh: echo v1/)).toBeDefined();
    expect(calls).toBe(1);
  });

  it("transitions to not-found when the matching workflow is removed", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json(calls === 1 ? [{ name: "alpha", steps: [{ sh: "echo a" }] }] : []);
      }),
    );

    const { sources } = renderWorkflow("alpha");
    await screen.findByRole("heading", { level: 2, name: /alpha/i });

    act(() => {
      sources[0]?.emit({ type: "workflow.removed", name: "alpha" });
    });

    await screen.findByRole("heading", { name: /workflow not found/i });
  });
});
