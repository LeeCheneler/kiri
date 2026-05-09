import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { App } from "./app.tsx";

afterEach(() => cleanup());

const renderAt = (path: string) => {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <App />
    </Router>,
  );
};

describe("<App>", () => {
  it("renders the kiri heading", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: /kiri/i })).toBeDefined();
  });

  it("routes / to the dashboard", () => {
    renderAt("/");
    // Dashboard's loading state is what we'll see synchronously before the
    // mocked fetch resolves; either way, the "Page not found" copy must
    // not appear when the route matched.
    expect(screen.queryByText(/page not found/i)).toBeNull();
  });

  it("renders 'page not found' for an unmatched path", () => {
    renderAt("/totally-unknown");
    expect(screen.getByText(/page not found/i)).toBeDefined();
  });
});
