import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import type { GitOverview } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ScanStatus } from "./scan-status.tsx";

const overview = (over: Partial<GitOverview> = {}): GitOverview => ({
  roots: ["/projects"],
  repos: [],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  ...over,
});

const renderStatus = (value: GitOverview | undefined) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ScanStatus overview={value} />
    </QueryClientProvider>,
  );

describe("<ScanStatus>", () => {
  it("says when the model on screen was last scanned", () => {
    renderStatus(overview());
    expect(screen.getByText(/scanned .* ago|scanned now/i)).toBeDefined();
  });

  it("says a scan is running rather than passing a stale model off as live", () => {
    renderStatus(overview({ refreshing: true }));
    expect(screen.getByText(/scanning/i)).toBeDefined();
  });

  it("says a scan is running before one has ever completed", () => {
    renderStatus(overview({ scannedAt: null }));
    expect(screen.getByText(/scanning/i)).toBeDefined();
  });

  it("offers the refresh alone until the first model arrives", () => {
    renderStatus(undefined);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDefined();
    expect(screen.queryByText(/scanned|scanning/i)).toBeNull();
  });

  it("reports a failed rescan with the server's reason", async () => {
    server.use(
      http.post("*/api/git/refresh", () =>
        HttpResponse.json({ error: "roots unreadable" }, { status: 500 }),
      ),
    );
    renderStatus(overview());

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
    renderStatus(overview());
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/couldn't rescan the roots/i);

    server.use(http.post("*/api/git/refresh", () => HttpResponse.json(overview())));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByText(/couldn't rescan the roots/i)).toBeNull();
  });
});
