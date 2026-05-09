import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PageShell } from "./page-shell.tsx";

afterEach(() => cleanup());

const renderShell = (children: ReactNode) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <PageShell>{children}</PageShell>
    </Router>,
  );
};

describe("<PageShell>", () => {
  it("renders children inside the main landmark", () => {
    renderShell(<p>route content here</p>);
    expect(screen.getByRole("main").textContent).toContain("route content here");
  });

  it("renders a kiri wordmark linking back to the dashboard", () => {
    renderShell(<p>x</p>);
    const wordmark = screen.getByRole("link", { name: /kiri/i });
    expect(wordmark.getAttribute("href")).toBe("/");
  });
});
