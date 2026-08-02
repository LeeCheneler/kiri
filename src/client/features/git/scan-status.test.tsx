import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { GitOverview } from "../../api.ts";
import { ScanFreshness } from "./scan-status.tsx";

const overview = (over: Partial<GitOverview> = {}): GitOverview => ({
  roots: ["/projects"],
  repos: [],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  ...over,
});

const renderFreshness = (value: GitOverview | undefined) =>
  render(<ScanFreshness overview={value} />);

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
