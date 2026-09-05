import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SiteNav } from "./site-nav.tsx";

const renderNav = (path = "/") => {
  const { hook } = memoryLocation({ path });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <SiteNav />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<SiteNav>", () => {
  it("renders the wordmark, the primary nav, the new-session action, and the docs links", async () => {
    renderNav();
    expect(screen.getByRole("heading", { name: /^kiri$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^activity$/i }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /^workflows$/i }).getAttribute("href")).toBe(
      "/workflows",
    );
    expect(screen.getByRole("button", { name: /new session/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /design system/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /github/i })).toBeDefined();
    // The version footer (MSW default "dev") confirms the rail mounted in full.
    expect(await screen.findByText("dev")).toBeDefined();
    expect(screen.getByRole("button", { name: "Theme" })).toBeDefined();
    await flushAsync();
  });

  it("highlights Activity on the home path", async () => {
    renderNav("/");
    expect(screen.getByRole("link", { name: /^activity$/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    await flushAsync();
  });

  it("highlights Workflows across the workflows section", async () => {
    renderNav("/workflows/deploy");
    expect(screen.getByRole("link", { name: /^workflows$/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    await flushAsync();
  });

  it("highlights Tools & MCP across the mcp section", async () => {
    renderNav("/mcp");
    expect(screen.getByRole("link", { name: /^tools & mcp$/i }).getAttribute("href")).toBe("/mcp");
    expect(screen.getByRole("link", { name: /^tools & mcp$/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    await flushAsync();
  });

  it("opens the navigation drawer with the rail content when the menu button is clicked", async () => {
    const user = userEvent.setup();
    renderNav("/");
    await user.click(await screen.findByRole("button", { name: /menu/i }));
    const drawer = screen.getByRole("dialog", { name: /navigation/i });
    expect(within(drawer).getByRole("link", { name: /^activity$/i })).toBeDefined();
    expect(within(drawer).getByRole("link", { name: /^workflows$/i })).toBeDefined();
    await flushAsync();
  });

  it("closes the drawer when a link inside it is selected", async () => {
    const user = userEvent.setup();
    renderNav("/");
    await user.click(await screen.findByRole("button", { name: /menu/i }));
    const drawer = screen.getByRole("dialog", { name: /navigation/i });
    // Selecting Workflows navigates, which the rail keys off to close itself.
    await user.click(within(drawer).getByRole("link", { name: /^workflows$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await flushAsync();
  });

  it("closes the drawer on a backdrop click", async () => {
    const user = userEvent.setup();
    renderNav("/");
    await user.click(await screen.findByRole("button", { name: /menu/i }));
    const drawer = screen.getByRole("dialog", { name: /navigation/i });
    // A backdrop click lands on the dialog element itself, dismissing it
    // without a route change.
    await user.click(drawer);
    expect(screen.queryByRole("dialog")).toBeNull();
    await flushAsync();
  });
});
