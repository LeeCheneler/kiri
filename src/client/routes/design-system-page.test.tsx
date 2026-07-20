import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { mockMermaid } from "../../../tests/setup/mermaid-mock.tsx";
import { mockReactVega } from "../../../tests/setup/react-vega-mock.tsx";
import { DesignSystemContent } from "./design-system-page.tsx";

// The catalogue embeds a lazy vega chart and a lazy mermaid diagram; mock both
// so the page renders without pulling in the real charting / diagram bundles.
mockReactVega();
mockMermaid();

describe("<DesignSystemPage>", () => {
  it("renders the design system page heading", async () => {
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    expect(screen.getByRole("heading", { name: /design system/i })).toBeDefined();
    // Let the lazy chart and mermaid diagram demos resolve so the test doesn't
    // leave a pending update behind.
    await screen.findAllByRole("figure");
  });

  it("opens and closes the Modal demo at each size", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    await screen.findAllByRole("figure");

    await user.click(screen.getByRole("button", { name: "open dialog (md)" }));
    expect(screen.getByRole("dialog", { name: /discard draft/i })).toBeDefined();
    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "open dialog (lg)" }));
    expect(screen.getByRole("dialog", { name: /discard draft/i })).toBeDefined();
    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "open dialog (full)" }));
    expect(screen.getByRole("dialog", { name: /discard draft/i })).toBeDefined();
    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens and settles the ConfirmModal demo at each emphasis", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    await screen.findAllByRole("figure");

    await user.click(screen.getByRole("button", { name: "confirm an action" }));
    const primary = screen.getByRole("dialog", { name: /run again\?/i });
    await user.click(within(primary).getByRole("button", { name: /^run again$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "confirm a destructive action" }));
    const negative = screen.getByRole("dialog", { name: /delete this run\?/i });
    await user.click(within(negative).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens and closes the Drawer demo", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    await screen.findAllByRole("figure");

    await user.click(screen.getByRole("button", { name: /open drawer/i }));
    expect(screen.getByRole("dialog", { name: /navigation/i })).toBeDefined();

    // A backdrop click lands on the dialog element itself and dismisses it.
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles a checkbox in the Checkbox demo", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    await screen.findAllByRole("figure");

    const architecture = screen.getByRole("checkbox", {
      name: "architecture",
    }) as HTMLInputElement;
    expect(architecture.checked).toBe(false);
    await user.click(architecture);
    expect(architecture.checked).toBe(true);
  });

  it("toggles a chip in the ToggleChip demo", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemContent />
      </Router>,
    );
    await screen.findAllByRole("figure");

    const science = screen.getByRole("checkbox", { name: "science" }) as HTMLInputElement;
    expect(science.checked).toBe(false);
    await user.click(science);
    expect(science.checked).toBe(true);
  });
});
