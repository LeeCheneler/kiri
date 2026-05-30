import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkflowSummary } from "../../api.ts";
import { WorkflowDetails } from "./workflow-details.tsx";

const wf = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "deploy",
  steps: [{ sh: "echo ok" }],
  ...overrides,
});

const renderDetails = (workflow: WorkflowSummary) => {
  const memory = memoryLocation({ path: "/workflows/deploy", record: true });
  return render(
    <Router hook={memory.hook}>
      <WorkflowDetails workflow={workflow} />
    </Router>,
  );
};

describe("<WorkflowDetails>", () => {
  it("shows the four detail tabs", () => {
    renderDetails(wf());
    for (const name of ["Recent runs", "Inputs", "Publishes", "Schema"]) {
      expect(screen.getByRole("tab", { name })).toBeDefined();
    }
  });

  it("opens on the recent-runs tab", () => {
    renderDetails(wf());
    expect(screen.getByText(/recent runs will appear here/i)).toBeDefined();
  });

  it("switches to the schema tab when selected", async () => {
    const user = userEvent.setup();
    renderDetails(wf({ steps: [{ use: "claude-code" }] }));
    await user.click(screen.getByRole("tab", { name: "Schema" }));
    expect(screen.getByText("claude-code")).toBeDefined();
  });
});
