import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { WorkflowSummary } from "../../api.ts";
import { RunWorkflow } from "./run-workflow.tsx";

const wf = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "brief",
  steps: [{ sh: "echo ok" }],
  ...overrides,
});

const renderRun = (workflow: WorkflowSummary) => {
  const memory = memoryLocation({ path: `/workflows/${workflow.name}`, record: true });
  render(
    <Router hook={memory.hook}>
      <RunWorkflow workflow={workflow} />
    </Router>,
  );
  return { history: memory.history };
};

describe("<RunWorkflow>", () => {
  it("runs immediately and navigates to the new run when there are no inputs", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/workflows/:name/runs", () =>
        HttpResponse.json({ runId: "run-1", status: "running" }, { status: 202 }),
      ),
    );
    const { history } = renderRun(wf());

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-1");
    });
  });

  it("opens the modal instead of running when the workflow declares inputs", async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    server.use(
      http.post("*/api/workflows/:name/runs", () => {
        posted.push("posted");
        return HttpResponse.json({ runId: "x", status: "running" }, { status: 202 });
      }),
    );
    renderRun(wf({ inputs: [{ name: "topic", required: true }] }));

    await user.click(screen.getByRole("button", { name: /run with inputs/i }));

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(posted).toEqual([]);
  });

  it("closes the modal when cancelled", async () => {
    const user = userEvent.setup();
    renderRun(wf({ inputs: [{ name: "topic", required: true }] }));

    await user.click(screen.getByRole("button", { name: /run with inputs/i }));
    expect(screen.getByRole("dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("surfaces an inline error when the bare run fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/workflows/:name/runs", () => new HttpResponse("nope", { status: 500 })),
    );
    renderRun(wf());

    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
  });

  it("forwards inputs collected from the modal and navigates", async () => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    server.use(
      http.post("*/api/workflows/:name/runs", async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ runId: "run-9", status: "running" }, { status: 202 });
      }),
    );
    const { history } = renderRun(wf({ inputs: [{ name: "topic", required: true }] }));

    await user.click(screen.getByRole("button", { name: /run with inputs/i }));
    await user.type(screen.getByRole("textbox", { name: /topic/i }), "chips");
    await user.click(screen.getByRole("button", { name: /run →/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-9");
    });
    expect(bodies).toEqual([JSON.stringify({ inputs: { topic: "chips" } })]);
  });
});
