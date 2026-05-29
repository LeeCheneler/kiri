import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { mockReactVega } from "../../../tests/setup/react-vega-mock.tsx";
import { DesignSystemPage } from "./design-system-page.tsx";

// The Markdown demo embeds a lazy vega chart; mock it so the page renders
// without pulling in the real charting bundle.
mockReactVega();

describe("<DesignSystemPage>", () => {
  it("renders the design system page heading", async () => {
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemPage />
      </Router>,
    );
    expect(screen.getByRole("heading", { name: /design system/i })).toBeDefined();
    // Let the lazy chart in the Markdown demo resolve so the test doesn't
    // leave a pending update behind.
    await screen.findByRole("figure");
  });

  it("opens and closes the Modal demo", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystemPage />
      </Router>,
    );
    await screen.findByRole("figure");

    await user.click(screen.getByRole("button", { name: /open dialog/i }));
    expect(screen.getByRole("dialog", { name: /discard draft/i })).toBeDefined();

    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
