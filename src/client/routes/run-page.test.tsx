import { afterEach, describe, expect, it } from "bun:test";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { RunPage } from "./run-page.tsx";

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
    // Stall the fetch indefinitely so the loading state stays visible
    // for the assertion. Default MSW handlers don't cover this path, so
    // without a pending responder the request would land as unhandled.
    server.use(http.get("*/api/runs/:id", () => new Promise<Response>(() => {})));
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
            articles: [],
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

  it("refetches when a workflow event for the matching workflow name fires", async () => {
    // Initial fetch returns the run + an empty workflows list (no inputs).
    // A workflow.updated event for the matching name triggers a refetch
    // and the new registry response declares inputs, arming the modal.
    let runFetches = 0;
    let wfFetches = 0;
    server.use(
      http.get("*/api/runs/:id", ({ params }) => {
        runFetches++;
        return HttpResponse.json({
          run: {
            id: params.id,
            workflowName: "edited",
            status: "ok",
            trigger: "manual",
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: "2026-05-09T12:00:01.000Z",
            error: null,
            summary: null,
            definitionSnapshot: { name: "edited", steps: [] },
            isInterrupted: false,
            articles: [],
            inputs: null,
          },
          steps: [],
        });
      }),
      http.get("*/api/workflows", () => {
        wfFetches++;
        return HttpResponse.json(
          wfFetches === 1
            ? [{ name: "edited", steps: [{ sh: "echo hi" }] }]
            : [
                {
                  name: "edited",
                  inputs: [{ name: "topic", required: true }],
                  steps: [{ sh: "echo hi" }],
                },
              ],
        );
      }),
    );

    const { sources } = renderRun("abc");
    await screen.findByRole("button", { name: /run again/i });
    expect(runFetches).toBe(1);
    expect(wfFetches).toBe(1);

    // Event for a *different* workflow name is filtered out — no refetch.
    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "other-thing" });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runFetches).toBe(1);
    expect(wfFetches).toBe(1);

    // Event for the matching name passes the filter and triggers refetch.
    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "edited" });
    });
    await waitFor(() => {
      expect(wfFetches).toBe(2);
    });
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
            articles: [],
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

  it("refreshes the article list in place when a run event arrives mid-run", async () => {
    // First fetch: pipeline running, no articles yet. After a run.updated
    // event the next fetch reflects the article the publish step just
    // produced — the Published section appears without a page reload.
    let calls = 0;
    server.use(
      http.get("*/api/runs/:id", ({ params }) => {
        calls++;
        const articles =
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
            articles,
          },
          steps: [],
        });
      }),
    );

    const { sources } = renderRun("abc");
    await screen.findByRole("heading", { level: 2, name: /with-publish/i });
    // No Published section yet — initial fetch returned no articles.
    expect(screen.queryByRole("heading", { name: /^published$/i })).toBeNull();

    act(() => {
      sources[0]?.emit({ type: "run.updated", id: "abc", status: "running" });
    });

    // The refetch driven by the event surfaces the new article row in place.
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
            articles: [],
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

  describe("delete button", () => {
    // Capture window.confirm so each test can pre-program the answer.
    // Restore on cleanup so a stubbed value can't leak into sibling tests.
    const originalConfirm = window.confirm;
    const stubConfirm = (answer: boolean) => {
      window.confirm = () => answer;
    };
    afterEach(() => {
      window.confirm = originalConfirm;
    });

    const terminalRunPayload = (id: string) => ({
      run: {
        id,
        workflowName: "done",
        status: "ok",
        trigger: "manual",
        startedAt: "2026-05-09T12:00:00.000Z",
        finishedAt: "2026-05-09T12:00:01.000Z",
        error: null,
        summary: null,
        definitionSnapshot: { name: "done", steps: [] },
        isInterrupted: false,
        articles: [],
      },
      steps: [],
    });

    const renderRunWithHistory = (id: string) => {
      const memory = memoryLocation({ path: `/runs/${id}`, record: true });
      const { factory } = captureEventSources();
      const ui = render(
        <Router hook={memory.hook}>
          <LiveEventsProvider factory={factory}>
            <RunPage params={{ id }} />
          </LiveEventsProvider>
        </Router>,
      );
      return { ...ui, history: memory.history };
    };

    it("confirms, calls DELETE /api/runs/:id, and navigates back to home", async () => {
      const deleteCalls: string[] = [];
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.delete("*/api/runs/:id", ({ params }) => {
          deleteCalls.push(String(params.id));
          return new HttpResponse(null, { status: 204 });
        }),
      );

      stubConfirm(true);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /^delete$/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(deleteCalls).toEqual(["abc"]);
      expect(history[history.length - 1]).toBe("/");
    });

    it("does not call the API or navigate when the user cancels the confirm prompt", async () => {
      const deleteCalls: string[] = [];
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.delete("*/api/runs/:id", ({ params }) => {
          deleteCalls.push(String(params.id));
          return new HttpResponse(null, { status: 204 });
        }),
      );

      stubConfirm(false);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /^delete$/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(deleteCalls).toEqual([]);
      // No navigation happened — the user is still on the run page.
      expect(history[history.length - 1]).toBe("/runs/abc");
    });

    it("navigates home even when the API returns 404 (already deleted in another tab)", async () => {
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.delete("*/api/runs/:id", () =>
          HttpResponse.json({ error: 'run "abc" not found' }, { status: 404 }),
        ),
      );

      stubConfirm(true);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /^delete$/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(history[history.length - 1]).toBe("/");
    });

    it("surfaces a non-404 API error inline without navigating", async () => {
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.delete("*/api/runs/:id", () =>
          HttpResponse.json({ error: 'run "abc" is in flight; cancel it first' }, { status: 409 }),
        ),
      );

      stubConfirm(true);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /^delete$/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("is in flight");
      expect(history[history.length - 1]).toBe("/runs/abc");
    });
  });

  describe("rerun button", () => {
    const originalConfirm = window.confirm;
    const stubConfirm = (answer: boolean) => {
      window.confirm = () => answer;
    };
    afterEach(() => {
      window.confirm = originalConfirm;
    });

    const terminalRunPayload = (
      id: string,
      runOverrides: { workflowName?: string; inputs?: Record<string, string> | null } = {},
    ) => ({
      run: {
        id,
        workflowName: runOverrides.workflowName ?? "done",
        status: "failed",
        trigger: "manual",
        startedAt: "2026-05-09T12:00:00.000Z",
        finishedAt: "2026-05-09T12:00:01.000Z",
        error: { message: "first attempt failed" },
        summary: null,
        definitionSnapshot: { name: runOverrides.workflowName ?? "done", steps: [] },
        isInterrupted: false,
        articles: [],
        inputs: runOverrides.inputs ?? null,
      },
      steps: [],
    });

    const renderRunWithHistory = (id: string) => {
      const memory = memoryLocation({ path: `/runs/${id}`, record: true });
      const { factory } = captureEventSources();
      const ui = render(
        <Router hook={memory.hook}>
          <LiveEventsProvider factory={factory}>
            <RunPage params={{ id }} />
          </LiveEventsProvider>
        </Router>,
      );
      return { ...ui, history: memory.history };
    };

    it("confirms and POSTs /api/runs/:id/rerun without navigating", async () => {
      const rerunCalls: string[] = [];
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.post("*/api/runs/:id/rerun", ({ params }) => {
          rerunCalls.push(String(params.id));
          return HttpResponse.json(
            { runId: String(params.id), status: "running" },
            { status: 202 },
          );
        }),
      );

      stubConfirm(true);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /run again/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(rerunCalls).toEqual(["abc"]);
      // Rerun stays on the page — SSE handles the live transition.
      expect(history[history.length - 1]).toBe("/runs/abc");
    });

    it("does not call the API when the user cancels the confirm prompt", async () => {
      const rerunCalls: string[] = [];
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.post("*/api/runs/:id/rerun", ({ params }) => {
          rerunCalls.push(String(params.id));
          return HttpResponse.json(
            { runId: String(params.id), status: "running" },
            { status: 202 },
          );
        }),
      );

      stubConfirm(false);
      renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /run again/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(rerunCalls).toEqual([]);
    });

    it("surfaces an API error inline without navigating", async () => {
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(terminalRunPayload(String(params.id))),
        ),
        http.post("*/api/runs/:id/rerun", () =>
          HttpResponse.json({ error: 'run "abc" is in flight; cancel it first' }, { status: 409 }),
        ),
      );

      stubConfirm(true);
      const { history } = renderRunWithHistory("abc");

      const button = await screen.findByRole("button", { name: /run again/i });
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // The failed run already renders its own "Run failed" alert section, so
      // query the rerun-button's inline error by text rather than role.
      await screen.findByText(/run "abc" is in flight; cancel it first/i);
      expect(history[history.length - 1]).toBe("/runs/abc");
    });

    describe("with workflow inputs", () => {
      // The registry handler returns a workflow declaring an `inputs:` block
      // so the run-page resolves it and switches the re-run path through the
      // modal. The prior run snapshot has `pr_number` + `branch` set; the
      // modal should pre-fill from them.
      const useInputsRegistry = () => {
        server.use(
          http.get("*/api/workflows", () =>
            HttpResponse.json([
              {
                name: "with-inputs",
                inputs: [
                  { name: "pr_number", required: true },
                  { name: "branch", default: "main" },
                ],
                steps: [{ sh: "echo hi" }],
              },
            ]),
          ),
        );
      };

      it("opens the modal pre-filled and POSTs the values to /rerun on submit", async () => {
        const rerunCalls: { id: string; body: string }[] = [];
        useInputsRegistry();
        server.use(
          http.get("*/api/runs/:id", ({ params }) =>
            HttpResponse.json(
              terminalRunPayload(String(params.id), {
                workflowName: "with-inputs",
                inputs: { pr_number: "42", branch: "release" },
              }),
            ),
          ),
          http.post("*/api/runs/:id/rerun", async ({ request, params }) => {
            rerunCalls.push({ id: String(params.id), body: await request.text() });
            return HttpResponse.json(
              { runId: String(params.id), status: "running" },
              { status: 202 },
            );
          }),
        );

        const { history } = renderRunWithHistory("abc");

        const user = userEvent.setup();
        const trigger = await screen.findByRole("button", { name: /run again/i });
        // Modal-aware path doesn't gate on window.confirm — pre-program it to
        // false to prove the click still opens the modal.
        stubConfirm(false);
        await user.click(trigger);

        const dialog = await screen.findByRole("dialog");
        expect((within(dialog).getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
        expect((within(dialog).getByLabelText(/branch/i) as HTMLInputElement).value).toBe(
          "release",
        );

        const pr = within(dialog).getByLabelText(/pr_number/i);
        await user.clear(pr);
        await user.type(pr, "99");
        await user.click(within(dialog).getByRole("button", { name: /^run/i }));

        expect(rerunCalls).toHaveLength(1);
        expect(rerunCalls[0].id).toBe("abc");
        expect(JSON.parse(rerunCalls[0].body)).toEqual({
          inputs: { pr_number: "99", branch: "release" },
        });
        // Rerun keeps the user on the run page — no navigation.
        expect(history[history.length - 1]).toBe("/runs/abc");
      });

      it("does not call window.confirm on the inputs path", async () => {
        let confirmCalls = 0;
        window.confirm = () => {
          confirmCalls++;
          return false;
        };

        useInputsRegistry();
        server.use(
          http.get("*/api/runs/:id", ({ params }) =>
            HttpResponse.json(
              terminalRunPayload(String(params.id), {
                workflowName: "with-inputs",
                inputs: { pr_number: "42" },
              }),
            ),
          ),
          http.post("*/api/runs/:id/rerun", ({ params }) =>
            HttpResponse.json({ runId: String(params.id), status: "running" }, { status: 202 }),
          ),
        );

        renderRunWithHistory("abc");
        const user = userEvent.setup();
        const trigger = await screen.findByRole("button", { name: /run again/i });
        await user.click(trigger);
        await screen.findByRole("dialog");
        expect(confirmCalls).toBe(0);
      });
    });
  });

  describe("recommendation action", () => {
    const runPayload = (
      id: string,
      recommendations: Array<{
        id: string;
        index: number;
        title: string;
        description: string | null;
        workflow: string;
        inputs: Record<string, string> | null;
        actionedRunId: string | null;
        actionedAt: string | null;
        actionedRunStatus: "running" | "ok" | "failed" | "cancelled" | null;
      }>,
    ) => ({
      run: {
        id,
        workflowName: "producer",
        status: "ok",
        trigger: "manual",
        startedAt: "2026-05-09T12:00:00.000Z",
        finishedAt: "2026-05-09T12:00:01.000Z",
        error: null,
        summary: null,
        definitionSnapshot: { name: "producer", steps: [] },
        gitSha: null,
        gitDirty: null,
        inputs: null,
        isInterrupted: false,
        articles: [],
        recommendations,
      },
      steps: [],
    });

    it("POSTs the user-edited inputs to /api/runs/:runId/recommendations/:recId/action", async () => {
      const seen: Array<{ runId: string; recId: string; body: string }> = [];
      server.use(
        http.get("*/api/runs/:id", ({ params }) =>
          HttpResponse.json(
            runPayload(String(params.id), [
              {
                id: "rec-1",
                index: 0,
                title: "Review PR #1",
                description: null,
                workflow: "pr-review",
                inputs: { pr_number: "1" },
                actionedRunId: null,
                actionedAt: null,
                actionedRunStatus: null,
              },
            ]),
          ),
        ),
        http.get("*/api/workflows", () =>
          HttpResponse.json([
            {
              name: "pr-review",
              inputs: [{ name: "pr_number", required: true }],
              steps: [{ sh: "echo review" }],
            },
          ]),
        ),
        http.post(
          "*/api/runs/:runId/recommendations/:recId/action",
          async ({ params, request }) => {
            seen.push({
              runId: String(params.runId),
              recId: String(params.recId),
              body: await request.text(),
            });
            return HttpResponse.json({ runId: "spawned-1", status: "running" }, { status: 202 });
          },
        ),
      );

      renderRun("producer-1");
      const user = userEvent.setup();
      // Page header carries "run again"; the rec row's button reads "run →".
      const recSection = (
        await screen.findByRole("heading", {
          name: /^recommended$/i,
        })
      ).closest("section");
      const trigger = within(recSection as HTMLElement).getByRole("button", { name: /^run →$/i });
      await user.click(trigger);
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: /^run →$/i }));

      await waitFor(() => {
        expect(seen).toHaveLength(1);
      });
      expect(seen[0].runId).toBe("producer-1");
      expect(seen[0].recId).toBe("rec-1");
      expect(JSON.parse(seen[0].body)).toEqual({ inputs: { pr_number: "1" } });
    });

    it("refetches on a recommendation.actioned event for this run", async () => {
      let calls = 0;
      server.use(
        http.get("*/api/runs/:id", ({ params }) => {
          calls++;
          return HttpResponse.json(
            runPayload(String(params.id), [
              {
                id: "rec-1",
                index: 0,
                title: calls === 1 ? "untriggered" : "actioned",
                description: null,
                workflow: "pr-review",
                inputs: null,
                actionedRunId: calls === 1 ? null : "spawned-1",
                actionedAt: calls === 1 ? null : "2026-05-09T12:00:30.000Z",
                actionedRunStatus: calls === 1 ? null : "running",
              },
            ]),
          );
        }),
      );

      const { sources } = renderRun("producer-1");
      await screen.findByText("untriggered");
      expect(calls).toBe(1);

      // Event for a different producing run is filtered out.
      act(() => {
        sources[0]?.emit({
          type: "recommendation.actioned",
          runId: "someone-else",
          recommendationId: "rec-x",
          actionedRunId: "x",
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(1);

      // Event for *this* run triggers a refetch — the row flips to its
      // status-badged link.
      act(() => {
        sources[0]?.emit({
          type: "recommendation.actioned",
          runId: "producer-1",
          recommendationId: "rec-1",
          actionedRunId: "spawned-1",
        });
      });

      await screen.findByText("actioned");
    });

    it("refetches on run.updated events for any actioned run id on this page", async () => {
      let calls = 0;
      server.use(
        http.get("*/api/runs/:id", ({ params }) => {
          calls++;
          return HttpResponse.json(
            runPayload(String(params.id), [
              {
                id: "rec-1",
                index: 0,
                title: "Review",
                description: null,
                workflow: "pr-review",
                inputs: null,
                actionedRunId: "spawned-7",
                actionedAt: "2026-05-09T12:00:30.000Z",
                actionedRunStatus: calls <= 1 ? "running" : "ok",
              },
            ]),
          );
        }),
      );

      const { sources } = renderRun("producer-1");
      await screen.findByRole("link", { name: /review/i });
      expect(calls).toBe(1);

      // Unrelated run id: filtered out, no refetch.
      act(() => {
        sources[0]?.emit({ type: "run.updated", id: "totally-other", status: "ok" });
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(1);

      // The actioned run id: matches the filter, refetch fires and the
      // status badge updates to the new terminal status.
      act(() => {
        sources[0]?.emit({ type: "run.updated", id: "spawned-7", status: "ok" });
      });
      await waitFor(() => {
        expect(calls).toBe(2);
      });
    });
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
            articles: [],
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
