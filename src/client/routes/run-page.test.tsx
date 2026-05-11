import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { RunPage } from "./run-page.tsx";

afterEach(() => cleanup());

const renderRun = (id: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}` });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <RunPage params={{ id }} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

describe("<RunPage>", () => {
  it("shows a loading message while the run is being fetched", () => {
    renderRun("abc");
    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("delegates to the run detail view when the run loads", async () => {
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
            artefacts: [],
          },
          steps: [],
        }),
      ),
    );

    renderRun("abc");

    expect(
      await screen.findByRole("heading", { level: 2, name: /kiri-self-review/i }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: /activity/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /all activity/i })).toBeDefined();
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
    expect(screen.getByRole("link", { name: /all activity/i }).getAttribute("href")).toBe("/");
  });

  it("renders a generic error view on non-404 failures", async () => {
    server.use(http.get("*/api/runs/:id", () => new HttpResponse("boom", { status: 500 })));

    renderRun("abc");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load run/i);
  });

  it("refetches when a run event for the matching id fires", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/runs/:id", ({ params }) => {
        calls++;
        return HttpResponse.json({
          run: {
            id: params.id,
            workflowName: `wf-${calls}`,
            status: "running",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: null,
            error: null,
            definitionSnapshot: { name: `wf-${calls}`, steps: [] },
            isInterrupted: false,
            artefacts: [],
          },
          steps: [],
        });
      }),
    );

    const { sources } = renderRun("abc");
    await screen.findByRole("heading", { level: 2, name: /wf-1/i });

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "abc", status: "ok" });
    });
    await screen.findByRole("heading", { level: 2, name: /wf-2/i });

    act(() => {
      sources[0]?.emit({
        type: "run.step.updated",
        runId: "abc",
        step: 0,
        status: "ok",
      });
    });
    await screen.findByRole("heading", { level: 2, name: /wf-3/i });

    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "wf",
      });
    });
    await screen.findByRole("heading", { level: 2, name: /wf-4/i });
  });

  it("refreshes the artefact list in place when a run event arrives mid-run", async () => {
    // First fetch: pipeline running, no artefacts yet. After a run.updated
    // event the next fetch reflects the artefact the publish step just
    // produced — the Published section appears without a page reload.
    let calls = 0;
    server.use(
      http.get("*/api/runs/:id", ({ params }) => {
        calls++;
        const artefacts =
          calls === 1
            ? []
            : [
                {
                  name: "digest",
                  title: "PR Review Digest",
                  createdAt: "2026-05-09T12:00:30.000Z",
                },
              ];
        return HttpResponse.json({
          run: {
            id: params.id,
            workflowName: "with-publish",
            status: "running",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: null,
            error: null,
            summary: null,
            definitionSnapshot: { name: "with-publish", steps: [] },
            isInterrupted: false,
            artefacts,
          },
          steps: [],
        });
      }),
    );

    const { sources } = renderRun("abc");
    await screen.findByRole("heading", { level: 2, name: /with-publish/i });
    // No Published section yet — initial fetch returned no artefacts.
    expect(screen.queryByRole("heading", { name: /^published$/i })).toBeNull();

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "abc", status: "running" });
    });

    // The refetch driven by the event surfaces the new artefact row in place.
    expect(await screen.findByRole("heading", { name: /^published$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /PR Review Digest/i }).getAttribute("href")).toBe(
      "/runs/abc/published/digest",
    );
  });

  it("wires the cancel button to POST /api/runs/:id/cancel", async () => {
    const cancelCalls: string[] = [];
    server.use(
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({
          run: {
            id: params.id,
            workflowName: "long",
            status: "running",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: null,
            error: null,
            definitionSnapshot: { name: "long", steps: [] },
            isInterrupted: false,
            artefacts: [],
          },
          steps: [],
        }),
      ),
      http.post("*/api/runs/:id/cancel", ({ params }) => {
        cancelCalls.push(String(params.id));
        return HttpResponse.json({ runId: params.id }, { status: 202 });
      }),
    );

    renderRun("abc");
    const button = await screen.findByRole("button", { name: /cancel run/i });

    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(cancelCalls).toEqual(["abc"]);
  });

  it("ignores events for other run ids", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/runs/:id", ({ params }) => {
        calls++;
        return HttpResponse.json({
          run: {
            id: params.id,
            workflowName: `wf-${calls}`,
            status: "running",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: null,
            error: null,
            definitionSnapshot: { name: `wf-${calls}`, steps: [] },
            isInterrupted: false,
            artefacts: [],
          },
          steps: [],
        });
      }),
    );

    const { sources } = renderRun("abc");
    await screen.findByRole("heading", { level: 2, name: /wf-1/i });

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "other", status: "ok" });
      sources[0]?.emit({
        type: "run.step.updated",
        runId: "other",
        step: 0,
        status: "ok",
      });
      sources[0]?.emit({
        type: "run.finished",
        id: "other",
        status: "ok",
        workflowName: "x",
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { level: 2, name: /wf-1/i })).toBeDefined();
    expect(calls).toBe(1);
  });
});
