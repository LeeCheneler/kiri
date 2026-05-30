import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkflowSummary } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { WorkflowDetails } from "./workflow-details.tsx";

const wf = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "deploy",
  steps: [{ sh: "echo ok" }],
  ...overrides,
});

const renderDetails = (workflow = wf()) => {
  const { hook } = memoryLocation({ path: "/workflows/deploy", record: true });
  return render(
    <Router hook={hook}>
      <QueryClientProvider client={createQueryClient()}>
        <WorkflowDetails workflow={workflow} />
      </QueryClientProvider>
    </Router>,
  );
};

// The Runs tab is the default and fetches its feed on mount; awaiting its
// settled (empty) state before interacting keeps the in-flight fetch from
// resolving after the test's DOM is torn down.
const awaitRunsSettled = () => screen.findByText(/no runs yet/i);

describe("<WorkflowDetails>", () => {
  it("shows the four detail tabs", async () => {
    renderDetails();
    for (const name of ["Runs", "Inputs", "Publishes", "Schema"]) {
      expect(screen.getByRole("tab", { name })).toBeDefined();
    }
    await awaitRunsSettled();
  });

  it("opens on the runs tab", async () => {
    renderDetails();
    expect(await awaitRunsSettled()).toBeDefined();
  });

  it("shows declared inputs when the inputs tab is selected", async () => {
    const user = userEvent.setup();
    renderDetails(wf({ inputs: [{ name: "pr_number", required: true }] }));
    await awaitRunsSettled();
    await user.click(screen.getByRole("tab", { name: "Inputs" }));
    expect(screen.getByText("pr_number")).toBeDefined();
  });

  it("shows publish entries when the publishes tab is selected", async () => {
    const user = userEvent.setup();
    renderDetails(wf({ publish: [{ name: "digest", title: "Digest", use: "writer" }] }));
    await awaitRunsSettled();
    await user.click(screen.getByRole("tab", { name: "Publishes" }));
    expect(screen.getByText("Digest")).toBeDefined();
  });

  it("switches to the schema tab when selected", async () => {
    const user = userEvent.setup();
    renderDetails(wf({ steps: [{ use: "claude-code" }] }));
    await awaitRunsSettled();
    await user.click(screen.getByRole("tab", { name: "Schema" }));
    expect(screen.getByText("claude-code")).toBeDefined();
  });
});
