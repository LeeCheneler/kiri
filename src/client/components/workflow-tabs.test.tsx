import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { type WorkflowTabDef, WorkflowTabs } from "./workflow-tabs.tsx";

afterEach(() => cleanup());

const TABS: WorkflowTabDef[] = [
  { id: "recent", label: "Recent runs", content: <p>recent panel</p> },
  { id: "inputs", label: "Inputs", content: <p>inputs panel</p> },
  { id: "steps", label: "Steps", content: <p>steps panel</p> },
  { id: "summariser", label: "Summariser", content: <p>summariser panel</p> },
  { id: "yaml", label: "YAML definition", content: <p>yaml panel</p> },
];

const renderTabs = (path = "/wf") => {
  const { hook, history } = memoryLocation({ path, record: true });
  const utils = render(
    <Router hook={hook}>
      <WorkflowTabs tabs={TABS} rightTabId="yaml" />
    </Router>,
  );
  return { ...utils, history };
};

describe("<WorkflowTabs>", () => {
  it("renders a tab for every entry inside a tablist", () => {
    renderTabs();
    expect(screen.getByRole("tablist")).toBeDefined();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    for (const { label } of TABS) {
      expect(screen.getByRole("tab", { name: label })).toBeDefined();
    }
  });

  it("activates the first tab when no ?tab is set", () => {
    renderTabs("/wf");
    expect(screen.getByRole("tab", { name: "Recent runs", selected: true })).toBeDefined();
    expect(screen.getByText("recent panel")).toBeDefined();
    expect(screen.queryByText("steps panel")).toBeNull();
  });

  it("activates the tab named by ?tab on mount", () => {
    renderTabs("/wf?tab=steps");
    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
    expect(screen.getByText("steps panel")).toBeDefined();
    expect(screen.queryByText("recent panel")).toBeNull();
  });

  it("falls back to the first tab when ?tab names an unknown tab", () => {
    renderTabs("/wf?tab=nope");
    expect(screen.getByRole("tab", { name: "Recent runs", selected: true })).toBeDefined();
    expect(screen.getByText("recent panel")).toBeDefined();
  });

  it("switches the active panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    renderTabs("/wf");

    await user.click(screen.getByRole("tab", { name: "Steps" }));

    expect(screen.getByRole("tab", { name: "Steps", selected: true })).toBeDefined();
    expect(screen.getByText("steps panel")).toBeDefined();
    expect(screen.queryByText("recent panel")).toBeNull();
  });

  it("writes the selected tab to the URL", async () => {
    const user = userEvent.setup();
    const { history } = renderTabs("/wf");

    await user.click(screen.getByRole("tab", { name: "YAML definition" }));

    expect(history.at(-1)).toContain("tab=yaml");
  });

  it("moves to and activates the next tab on ArrowRight", async () => {
    const user = userEvent.setup();
    renderTabs("/wf");

    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{ArrowRight}");

    const inputsTab = screen.getByRole("tab", { name: "Inputs" });
    expect(inputsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(inputsTab);
    expect(screen.getByText("inputs panel")).toBeDefined();
  });

  it("wraps from the first tab to the last on ArrowLeft", async () => {
    const user = userEvent.setup();
    renderTabs("/wf");

    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{ArrowLeft}");

    const yamlTab = screen.getByRole("tab", { name: "YAML definition" });
    expect(yamlTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(yamlTab);
  });

  it("jumps to the last tab on End and the first on Home", async () => {
    const user = userEvent.setup();
    renderTabs("/wf");

    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "YAML definition", selected: true })).toBeDefined();

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Recent runs", selected: true })).toBeDefined();
  });

  it("ignores keys other than the arrow and Home/End navigation keys", async () => {
    const user = userEvent.setup();
    renderTabs("/wf");

    screen.getAllByRole("tab")[0].focus();
    await user.keyboard("a");

    expect(screen.getByRole("tab", { name: "Recent runs", selected: true })).toBeDefined();
  });

  it("wires id, aria-controls and aria-labelledby between the active tab and its panel", () => {
    renderTabs("/wf?tab=steps");

    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const panel = screen.getByRole("tabpanel");

    expect(stepsTab.getAttribute("id")).toBe("wf-tab-steps");
    expect(stepsTab.getAttribute("aria-controls")).toBe("wf-panel-steps");
    expect(panel.getAttribute("id")).toBe("wf-panel-steps");
    expect(panel.getAttribute("aria-labelledby")).toBe("wf-tab-steps");
  });

  it("gives only the active tab a tabIndex of 0", () => {
    renderTabs("/wf?tab=steps");

    for (const tab of screen.getAllByRole("tab")) {
      const expected = tab.getAttribute("aria-selected") === "true" ? "0" : "-1";
      expect(tab.getAttribute("tabindex")).toBe(expected);
    }
  });
});
