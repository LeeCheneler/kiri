import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { type TabDef, Tabs } from "./tabs.tsx";

const TABS: TabDef[] = [
  { id: "runs", label: "Runs", content: <p>runs panel</p> },
  { id: "inputs", label: "Inputs", content: <p>inputs panel</p> },
  { id: "steps", label: "Steps", content: <p>steps panel</p> },
];

const renderTabs = (path = "/wf") => {
  const { hook, history } = memoryLocation({ path, record: true });
  render(
    <Router hook={hook}>
      <Tabs tabs={TABS} label="Workflow views" />
    </Router>,
  );
  return { user: userEvent.setup(), history };
};

describe("<Tabs>", () => {
  it("renders a tab for every entry inside the labelled tablist", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Workflow views" })).toBeDefined();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("activates the first tab when the param is absent", () => {
    renderTabs("/wf");
    expect(screen.getByRole("tab", { name: "Runs", selected: true })).toBeDefined();
    expect(screen.getByText("runs panel")).toBeDefined();
    expect(screen.queryByText("steps panel")).toBeNull();
  });

  it("activates the tab named by the param on mount", () => {
    renderTabs("/wf?tab=steps");
    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
    expect(screen.getByText("steps panel")).toBeDefined();
    expect(screen.queryByText("runs panel")).toBeNull();
  });

  it("falls back to the first tab when the param names an unknown tab", () => {
    renderTabs("/wf?tab=nope");
    expect(screen.getByRole("tab", { name: "Runs", selected: true })).toBeDefined();
    expect(screen.getByText("runs panel")).toBeDefined();
  });

  it("switches the active panel when a tab is clicked, writing it to the URL", async () => {
    const { user, history } = renderTabs("/wf");
    await user.click(screen.getByRole("tab", { name: "Steps" }));
    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
    expect(screen.getByText("steps panel")).toBeDefined();
    expect(screen.queryByText("runs panel")).toBeNull();
    expect(history.at(-1)).toContain("tab=steps");
  });

  it("moves to and activates the next tab on ArrowRight", async () => {
    const { user } = renderTabs("/wf");
    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{ArrowRight}");
    const inputsTab = screen.getByRole("tab", { name: "Inputs" });
    expect(inputsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(inputsTab);
    expect(screen.getByText("inputs panel")).toBeDefined();
  });

  it("wraps from the first tab to the last on ArrowLeft", async () => {
    const { user } = renderTabs("/wf");
    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
  });

  it("jumps to the last tab on End and back to the first on Home", async () => {
    const { user } = renderTabs("/wf");
    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Runs", selected: true })).toBeDefined();
  });

  it("ignores keys other than the arrow and Home/End navigation keys", async () => {
    const { user } = renderTabs("/wf");
    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("a");
    expect(screen.getByRole("tab", { name: "Runs", selected: true })).toBeDefined();
  });

  it("wires aria-controls and aria-labelledby between the active tab and its panel", () => {
    renderTabs("/wf?tab=steps");
    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const panel = screen.getByRole("tabpanel");
    expect(stepsTab.getAttribute("aria-controls")).toBe(panel.getAttribute("id"));
    expect(panel.getAttribute("aria-labelledby")).toBe(stepsTab.getAttribute("id"));
  });

  it("gives only the active tab a tabIndex of 0", () => {
    renderTabs("/wf?tab=steps");
    for (const tab of screen.getAllByRole("tab")) {
      const expected = tab.getAttribute("aria-selected") === "true" ? "0" : "-1";
      expect(tab.getAttribute("tabindex")).toBe(expected);
    }
  });
});
