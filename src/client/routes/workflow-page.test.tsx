import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { WorkflowPage } from "./workflow-page.tsx";

afterEach(() => cleanup());

const renderWorkflow = (name: string, initialPath = `/workflows/${name}`) => {
  const memory = memoryLocation({ path: initialPath, record: true });
  const ui = render(
    <Router hook={memory.hook}>
      <WorkflowPage params={{ name }} />
    </Router>,
  );
  return { ...ui, history: memory.history };
};

describe("<WorkflowPage>", () => {
  it("shows a loading message while the registry is being fetched", () => {
    renderWorkflow("kiri-self-review");
    expect(screen.getByText(/loading workflow/i)).toBeDefined();
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

  it("triggers a run and navigates to the run detail on success", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "kiri-self-review", steps: [{ sh: "echo ok" }] }]),
      ),
      http.post("*/api/workflows/:name/runs", ({ params }) =>
        HttpResponse.json({ runId: `run-${String(params.name)}-fresh`, status: "ok" }),
      ),
    );

    const { history } = renderWorkflow("kiri-self-review");

    fireEvent.click(await screen.findByRole("button", { name: /^run/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-kiri-self-review-fresh");
    });
  });
});
