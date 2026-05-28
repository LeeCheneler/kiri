import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkflowSummary } from "../api.ts";
import { WorkflowsNav } from "./workflows-nav.tsx";

const renderNav = (workflows: WorkflowSummary[], activeName: string | null = null) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <WorkflowsNav workflows={workflows} activeName={activeName} />
    </Router>,
  );
};

const wf = (name: string): WorkflowSummary => ({ name, steps: [] });

describe("<WorkflowsNav>", () => {
  it("renders an empty-state sentence pointing at kiri init and workflows/ when no workflows exist", () => {
    renderNav([]);
    const text = screen.getByText(/no workflows yet/i);
    expect(text.textContent).toContain("kiri init");
    expect(text.textContent).toContain("workflows/");
  });

  it("renders a nav landmark labelled 'workflows' with one row per workflow", () => {
    renderNav([wf("alpha"), wf("beta"), wf("gamma")]);
    const nav = screen.getByRole("navigation", { name: /workflows/i });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders each workflow name as a link to /workflows/:name", () => {
    renderNav([wf("pr-review")]);
    const link = screen.getByRole("link", { name: /pr-review/i });
    expect(link.getAttribute("href")).toBe("/workflows/pr-review");
  });

  it("URL-encodes workflow names with characters that need escaping", () => {
    renderNav([wf("flow with space")]);
    const link = screen.getByRole("link", { name: /flow with space/i });
    expect(link.getAttribute("href")).toBe("/workflows/flow%20with%20space");
  });

  it("marks the active workflow with aria-current='page'", () => {
    renderNav([wf("alpha"), wf("beta")], "beta");
    const beta = screen.getByRole("link", { name: /beta/i });
    const alpha = screen.getByRole("link", { name: /alpha/i });
    expect(beta.getAttribute("aria-current")).toBe("page");
    expect(alpha.getAttribute("aria-current")).toBeNull();
  });

  it("does not mark any row when no workflow matches the active name", () => {
    renderNav([wf("alpha"), wf("beta")], null);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });
});
