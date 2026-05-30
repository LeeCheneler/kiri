import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkflowSummary } from "../../api.ts";
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
const grouped = (name: string, group: string): WorkflowSummary => ({ name, group, steps: [] });

describe("<WorkflowsNav>", () => {
  it("renders an empty-state sentence pointing at kiri init and workflows/ when none exist", () => {
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
    expect(screen.getByRole("link", { name: /pr-review/i }).getAttribute("href")).toBe(
      "/workflows/pr-review",
    );
  });

  it("URL-encodes workflow names with characters that need escaping", () => {
    renderNav([wf("flow with space")]);
    expect(screen.getByRole("link", { name: /flow with space/i }).getAttribute("href")).toBe(
      "/workflows/flow%20with%20space",
    );
  });

  it("marks the active workflow with aria-current='page'", () => {
    renderNav([wf("alpha"), wf("beta")], "beta");
    expect(screen.getByRole("link", { name: /beta/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /alpha/i }).getAttribute("aria-current")).toBeNull();
  });

  it("does not mark any row when no workflow matches the active name", () => {
    renderNav([wf("alpha"), wf("beta")], null);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("buckets grouped workflows under a sub-heading and lists ungrouped ones flat", () => {
    renderNav([wf("hello-world"), grouped("lint", "Dev"), grouped("deploy", "Ops")]);
    expect(screen.getByRole("link", { name: /hello-world/i })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Dev" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Ops" })).toBeDefined();
    expect(screen.getByRole("link", { name: /lint/i }).getAttribute("href")).toBe(
      "/workflows/lint",
    );
  });

  it("collects workflows that share a group under a single sub-heading", () => {
    renderNav([grouped("lint", "Dev"), grouped("test", "Dev")]);
    expect(screen.getAllByRole("heading", { name: "Dev" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /lint/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /test/i })).toBeDefined();
  });

  it("marks the active workflow even when it lives inside a group", () => {
    renderNav([grouped("lint", "Dev"), grouped("test", "Dev")], "test");
    expect(screen.getByRole("link", { name: /test/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /lint/i }).getAttribute("aria-current")).toBeNull();
  });
});
