import { afterEach, describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  lastMermaidSource,
  mockMermaid,
  resetMermaid,
  setMermaidOutcome,
} from "../../../../tests/setup/mermaid-mock.tsx";

mockMermaid();
const { Mermaid } = await import("./mermaid.tsx");

// Tabs reads the active tab off wouter's search params even in local mode, so
// every render needs a router in context.
const renderMermaid = (node: ReactNode) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(<Router hook={hook}>{node}</Router>);
};

const SOURCE = "graph TD\n  A-->B";

afterEach(resetMermaid);

describe("<Mermaid>", () => {
  it("renders the diagram from the source on the default tab", async () => {
    const { container } = renderMermaid(<Mermaid source={SOURCE} />);
    await screen.findByRole("figure");
    expect(container.querySelector("figure svg")).not.toBeNull();
    expect(lastMermaidSource()).toBe(SOURCE);
  });

  it("shows the raw source with a copy action when the Source tab is selected", async () => {
    const user = userEvent.setup();
    const { container } = renderMermaid(<Mermaid source={SOURCE} />);
    await screen.findByRole("figure");

    await user.click(screen.getByRole("tab", { name: "Source" }));
    expect(container.querySelector("pre code")?.textContent).toBe(SOURCE);
    expect(screen.getByRole("button", { name: /copy source/i })).toBeDefined();
    // The diagram panel unmounts when its tab is inactive.
    expect(container.querySelector("figure")).toBeNull();
  });

  it("enlarges the diagram in a modal and closes it again", async () => {
    const user = userEvent.setup();
    renderMermaid(<Mermaid source={SOURCE} />);
    await screen.findByRole("figure");

    await user.click(screen.getByRole("button", { name: "Enlarge" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("svg")).not.toBeNull();

    // A click on the dialog element itself is a backdrop dismissal.
    await user.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("degrades to an inline alert when the diagram fails to render", async () => {
    setMermaidOutcome({ error: "Parse error on line 1" });
    renderMermaid(<Mermaid source={"not a diagram"} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be rendered/i);
    expect(alert.textContent).toMatch(/Parse error/i);
  });
});
