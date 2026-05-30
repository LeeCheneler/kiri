import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SiteNav } from "./site-nav.tsx";

const workflow = (name: string) => ({ name, steps: [] });

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
  it("renders the wordmark, home, and documentation links", async () => {
    renderNav();
    expect(await screen.findByRole("heading", { name: /^kiri$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^home$/i }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /design system/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /github/i })).toBeDefined();
    // The version footer (MSW default "dev") confirms the rail mounted in full.
    expect(await screen.findByText("dev")).toBeDefined();
    await flushAsync();
  });

  it("renders the rail without the workflows nav when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));
    renderNav();
    expect(await screen.findByRole("heading", { name: /^kiri$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^home$/i })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: /^workflows$/i })).toBeNull();
    await flushAsync();
  });

  it("renders immediately, without the entrance fade, when the registry is cached", async () => {
    const client = createQueryClient();
    client.setQueryData(["workflows"], [workflow("deploy")]);
    const { hook } = memoryLocation({ path: "/" });
    render(
      <QueryClientProvider client={client}>
        <Router hook={hook}>
          <SiteNav />
        </Router>
      </QueryClientProvider>,
    );
    // Cache hit → no loading gate; the rail is present synchronously, so a
    // navigation back to a cached registry doesn't flash.
    expect(screen.getByRole("heading", { name: /^kiri$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: "deploy" })).toBeDefined();
    await flushAsync();
  });

  it("lists workflows from the registry once it resolves", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([workflow("deploy"), workflow("release")]),
      ),
    );
    renderNav();
    expect(await screen.findByRole("link", { name: "deploy" })).toBeDefined();
    expect(screen.getByRole("link", { name: "release" })).toBeDefined();
    await flushAsync();
  });

  it("renders nothing until the registry resolves", async () => {
    server.use(http.get("*/api/workflows", () => new Promise(() => {})));
    renderNav();
    expect(screen.queryByRole("heading", { name: /^kiri$/i })).toBeNull();
    await flushAsync();
  });

  it("marks the active workflow from the current path", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy")])));
    renderNav("/workflows/deploy");
    const active = await screen.findByRole("link", { name: "deploy" });
    expect(active.getAttribute("aria-current")).toBe("page");
    await flushAsync();
  });

  it("decodes an encoded workflow name from the path", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy prod")])));
    renderNav("/workflows/deploy%20prod");
    const active = await screen.findByRole("link", { name: "deploy prod" });
    expect(active.getAttribute("aria-current")).toBe("page");
    await flushAsync();
  });

  it("falls back to the raw segment when the path is malformed", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("%")])));
    renderNav("/workflows/%");
    const active = await screen.findByRole("link", { name: "%" });
    expect(active.getAttribute("aria-current")).toBe("page");
    await flushAsync();
  });

  it("opens the navigation drawer with the rail content when the menu button is clicked", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy")])));
    renderNav("/");
    await user.click(await screen.findByRole("button", { name: /menu/i }));
    const drawer = screen.getByRole("dialog", { name: /navigation/i });
    expect(within(drawer).getByRole("link", { name: /^home$/i })).toBeDefined();
    expect(within(drawer).getByRole("link", { name: "deploy" })).toBeDefined();
    await flushAsync();
  });

  it("closes the drawer when a link inside it is selected", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy")])));
    renderNav("/");
    await user.click(await screen.findByRole("button", { name: /menu/i }));
    const drawer = screen.getByRole("dialog", { name: /navigation/i });
    // Selecting a workflow navigates, which the rail keys off to close itself.
    await user.click(within(drawer).getByRole("link", { name: "deploy" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await flushAsync();
  });

  it("closes the drawer on a backdrop click", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy")])));
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
