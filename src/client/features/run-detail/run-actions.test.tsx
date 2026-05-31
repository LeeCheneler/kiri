import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { RunDetailRun, WorkflowInputSummary } from "../../api.ts";
import { RunActions } from "./run-actions.tsx";

const originalConfirm = window.confirm;
afterEach(() => {
  window.confirm = originalConfirm;
});

const makeRun = (overrides: Partial<RunDetailRun> = {}): RunDetailRun => ({
  id: "run-1",
  workflowName: "pr-review",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:42.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "pr-review", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  recommendations: [],
  ...overrides,
});

const renderActions = (run: RunDetailRun, workflowInputs?: WorkflowInputSummary[]) => {
  const memory = memoryLocation({ path: `/runs/${run.id}`, record: true });
  render(
    <Router hook={memory.hook}>
      <RunActions run={run} workflowInputs={workflowInputs} />
    </Router>,
  );
  return { history: memory.history };
};

describe("<RunActions>", () => {
  it("offers only cancel while the run is in flight, and cancels it", async () => {
    const user = userEvent.setup();
    const cancelled: string[] = [];
    server.use(
      http.post("*/api/runs/:id/cancel", ({ params }) => {
        cancelled.push(String(params.id));
        return HttpResponse.json({ runId: "run-1" }, { status: 202 });
      }),
    );
    renderActions(makeRun({ status: "running", finishedAt: null }));

    expect(screen.queryByRole("button", { name: /run again/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /cancel run/i }));
    await waitFor(() => expect(cancelled).toEqual(["run-1"]));
  });

  it("surfaces an inline error when cancel fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/runs/:id/cancel", () =>
        HttpResponse.json({ error: "already finished" }, { status: 409 }),
      ),
    );
    renderActions(makeRun({ status: "running", finishedAt: null }));

    await user.click(screen.getByRole("button", { name: /cancel run/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already finished/i));
  });

  it("re-runs a no-input workflow after a confirm", async () => {
    const user = userEvent.setup();
    window.confirm = () => true;
    const rerun: string[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", ({ params }) => {
        rerun.push(String(params.id));
        return HttpResponse.json({ runId: "run-1", status: "running" }, { status: 202 });
      }),
    );
    renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /run again/i }));
    await waitFor(() => expect(rerun).toEqual(["run-1"]));
  });

  it("does not re-run when the confirm is dismissed", async () => {
    const user = userEvent.setup();
    window.confirm = () => false;
    const rerun: string[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", () => {
        rerun.push("x");
        return HttpResponse.json({ runId: "x", status: "running" }, { status: 202 });
      }),
    );
    renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /run again/i }));
    expect(rerun).toEqual([]);
  });

  it("surfaces an inline error when re-run fails", async () => {
    const user = userEvent.setup();
    window.confirm = () => true;
    server.use(
      http.post("*/api/runs/:id/rerun", () =>
        HttpResponse.json({ error: "still in flight" }, { status: 409 }),
      ),
    );
    renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /run again/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/still in flight/i));
  });

  it("opens a pre-filled modal for a workflow with inputs and forwards tweaks", async () => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ runId: "run-1", status: "running" }, { status: 202 });
      }),
    );
    renderActions(makeRun({ inputs: { pr_number: "42", branch: "main" } }), [
      { name: "pr_number", required: true },
      { name: "branch", default: "main" },
    ]);

    await user.click(screen.getByRole("button", { name: /run again/i }));
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByRole("textbox", { name: /pr_number/i }) as HTMLInputElement).value,
    ).toBe("42");
    expect(within(dialog).getByRole("note").textContent).toMatch(/previous attempt/i);

    const field = within(dialog).getByRole("textbox", { name: /pr_number/i });
    await user.clear(field);
    await user.type(field, "99");
    await user.click(within(dialog).getByRole("button", { name: /run →/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bodies).toEqual([JSON.stringify({ inputs: { pr_number: "99", branch: "main" } })]);
  });

  it("closes the re-run modal without re-running when cancelled", async () => {
    const user = userEvent.setup();
    const rerun: string[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", () => {
        rerun.push("x");
        return HttpResponse.json({ runId: "x", status: "running" }, { status: 202 });
      }),
    );
    renderActions(makeRun(), [{ name: "topic", required: true }]);

    await user.click(screen.getByRole("button", { name: /run again/i }));
    expect(screen.getByRole("dialog")).toBeDefined();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rerun).toEqual([]);
  });

  it("deletes after a confirm and navigates home", async () => {
    const user = userEvent.setup();
    window.confirm = () => true;
    server.use(http.delete("*/api/runs/:id", () => new HttpResponse(null, { status: 204 })));
    const { history } = renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/"));
  });

  it("does not delete when the confirm is dismissed", async () => {
    const user = userEvent.setup();
    window.confirm = () => false;
    const deleted: string[] = [];
    server.use(
      http.delete("*/api/runs/:id", () => {
        deleted.push("x");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleted).toEqual([]);
    expect(history[history.length - 1]).toBe("/runs/run-1");
  });

  it("treats a 404 on delete as already-gone and navigates home", async () => {
    const user = userEvent.setup();
    window.confirm = () => true;
    server.use(
      http.delete("*/api/runs/:id", () => HttpResponse.json({ error: "gone" }, { status: 404 })),
    );
    const { history } = renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/"));
  });

  it("surfaces an inline error when delete fails for another reason", async () => {
    const user = userEvent.setup();
    window.confirm = () => true;
    server.use(
      http.delete("*/api/runs/:id", () =>
        HttpResponse.json({ error: "still in flight" }, { status: 409 }),
      ),
    );
    const { history } = renderActions(makeRun());

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/still in flight/i));
    expect(history[history.length - 1]).toBe("/runs/run-1");
  });

  it("disables re-run when the workflow is no longer in the registry", () => {
    renderActions(makeRun({ isInterrupted: true }));
    const rerun = screen.getByRole("button", { name: /run again/i }) as HTMLButtonElement;
    expect(rerun.disabled).toBe(true);
    expect(rerun.getAttribute("title")).toMatch(/no longer exists/i);
  });
});
