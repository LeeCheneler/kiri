import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { GitOverview } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RefreshGit, ScanFreshness } from "./scan-status.tsx";

const overview = (over: Partial<GitOverview> = {}): GitOverview => ({
  roots: ["/projects"],
  repos: [],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  ...over,
});

const renderFreshness = (value: GitOverview | undefined) =>
  render(<ScanFreshness overview={value} />);

const renderRefresh = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RefreshGit />
    </QueryClientProvider>,
  );

describe("<ScanFreshness>", () => {
  it("says when the model on screen was last scanned", () => {
    renderFreshness(overview());
    expect(screen.getByText(/scanned .* ago|scanned now/i)).toBeDefined();
  });

  it("says a scan is running rather than passing a stale model off as live", () => {
    renderFreshness(overview({ refreshing: true }));
    expect(screen.getByText(/scanning/i)).toBeDefined();
  });

  it("says a scan is running before one has ever completed", () => {
    renderFreshness(overview({ scannedAt: null }));
    expect(screen.getByText(/scanning/i)).toBeDefined();
  });

  it("has nothing to say until the first model arrives", () => {
    const { container } = renderFreshness(undefined);
    expect(container.firstChild).toBeNull();
  });
});

describe("<RefreshGit>", () => {
  it("reports a failed rescan with the server's reason", async () => {
    server.use(
      http.post("*/api/git/refresh", () =>
        HttpResponse.json({ error: "roots unreadable" }, { status: 500 }),
      ),
    );
    renderRefresh();

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/couldn't rescan the roots/i)).toBeDefined();
    expect(screen.getByText("roots unreadable")).toBeDefined();
  });

  it("clears a reported failure once a rescan succeeds", async () => {
    server.use(
      http.post("*/api/git/refresh", () =>
        HttpResponse.json({ error: "roots unreadable" }, { status: 500 }),
      ),
    );
    renderRefresh();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/couldn't rescan the roots/i);

    server.use(http.post("*/api/git/refresh", () => HttpResponse.json(overview())));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByText(/couldn't rescan the roots/i)).toBeNull();
  });
});
