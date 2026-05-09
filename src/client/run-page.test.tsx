import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../tests/setup/msw.ts";
import { RunPage } from "./run-page.tsx";

afterEach(() => cleanup());

const renderRun = (id: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}` });
  return render(
    <Router hook={hook}>
      <RunPage params={{ id }} />
    </Router>,
  );
};

describe("<RunPage>", () => {
  it("shows a loading message while the run is being fetched", () => {
    renderRun("abc");
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("renders the workflow name and status when the run loads", async () => {
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
            isOrphan: false,
          },
          steps: [],
        }),
      ),
    );

    renderRun("abc");

    expect(await screen.findByRole("heading", { name: /kiri-self-review/i })).toBeDefined();
    expect(screen.getByText(/status: ok/i)).toBeDefined();
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
