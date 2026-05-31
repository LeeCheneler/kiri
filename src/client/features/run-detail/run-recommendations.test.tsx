import { describe, expect, it } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { RecommendationSummary, WorkflowSummary } from "../../api.ts";
import { RunRecommendations } from "./run-recommendations.tsx";

const ACTION = "*/api/runs/:runId/recommendations/:recId/action";

const makeRec = (overrides: Partial<RecommendationSummary> = {}): RecommendationSummary => ({
  id: "rec-1",
  index: 0,
  title: "Review PR #42",
  description: "+500/-200, refactor auth",
  workflow: "pr-review",
  inputs: null,
  actionedRunId: null,
  actionedAt: null,
  actionedRunStatus: null,
  ...overrides,
});

const wf = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "pr-review",
  steps: [{ sh: "echo ok" }],
  ...overrides,
});

const renderRecs = (
  recommendations: RecommendationSummary[],
  workflows: WorkflowSummary[] = [wf()],
) => {
  const memory = memoryLocation({ path: "/runs/run-1", record: true });
  render(
    <Router hook={memory.hook}>
      <RunRecommendations runId="run-1" recommendations={recommendations} workflows={workflows} />
    </Router>,
  );
  return { history: memory.history };
};

describe("<RunRecommendations>", () => {
  it("renders nothing when the run produced no recommendations", () => {
    renderRecs([]);
    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("lists each recommendation under a Recommended heading", () => {
    renderRecs([makeRec(), makeRec({ id: "rec-2", title: "Review PR #43", description: null })]);

    expect(screen.getByText("Recommended")).toBeDefined();
    expect(screen.getByText("Review PR #42")).toBeDefined();
    expect(screen.getByText("+500/-200, refactor auth")).toBeDefined();
    expect(screen.getByText("Review PR #43")).toBeDefined();
  });

  it("actions a no-input recommendation directly", async () => {
    const user = userEvent.setup();
    const actioned: string[] = [];
    server.use(
      http.post(ACTION, ({ params }) => {
        actioned.push(`${params.runId}/${params.recId}`);
        return HttpResponse.json({ runId: "spawned", status: "running" }, { status: 202 });
      }),
    );
    renderRecs([makeRec()]);

    await user.click(screen.getByRole("button", { name: /run →/ }));

    await waitFor(() => expect(actioned).toEqual(["run-1/rec-1"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a pre-filled modal when the target workflow declares inputs", async () => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    server.use(
      http.post(ACTION, async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ runId: "spawned", status: "running" }, { status: 202 });
      }),
    );
    renderRecs(
      [makeRec({ inputs: { pr_number: "42", branch: "main" } })],
      [
        wf({
          inputs: [
            { name: "pr_number", required: true },
            { name: "branch", default: "main" },
          ],
        }),
      ],
    );

    await user.click(screen.getByRole("button", { name: /run →/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByRole("textbox", { name: /pr_number/i }) as HTMLInputElement).value,
    ).toBe("42");

    await user.click(within(dialog).getByRole("button", { name: /run →/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bodies).toEqual([JSON.stringify({ inputs: { pr_number: "42", branch: "main" } })]);
  });

  it("closes the modal without actioning when cancelled", async () => {
    const user = userEvent.setup();
    const actioned: string[] = [];
    server.use(
      http.post(ACTION, () => {
        actioned.push("x");
        return HttpResponse.json({ runId: "x", status: "running" }, { status: 202 });
      }),
    );
    renderRecs(
      [makeRec({ inputs: { topic: "x" } })],
      [wf({ inputs: [{ name: "topic", required: true }] })],
    );

    await user.click(screen.getByRole("button", { name: /run →/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actioned).toEqual([]);
  });

  it("surfaces an inline error when the trigger fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(ACTION, () => HttpResponse.json({ error: "already actioned" }, { status: 409 })),
    );
    renderRecs([makeRec()]);

    await user.click(screen.getByRole("button", { name: /run →/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already actioned/i));
  });

  it("disables the trigger when the target workflow is not in the registry", () => {
    renderRecs([makeRec({ workflow: "gone" })]);

    const trigger = screen.getByRole("button", { name: /run →/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("title")).toMatch(/workflow not found/i);
  });

  it("renders a triggered recommendation as a status-badged link to the spawned run", () => {
    renderRecs([makeRec({ actionedRunId: "spawned-9", actionedRunStatus: "ok" })]);

    const link = screen.getByRole("link", { name: /review pr #42/i });
    expect(link.getAttribute("href")).toBe("/runs/spawned-9");
    expect(screen.queryByRole("button", { name: /run →/ })).toBeNull();
    expect(screen.getByText("ok").getAttribute("data-status")).toBe("ok");
  });
});
