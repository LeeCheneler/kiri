import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { BackLink } from "./back-link.tsx";

const renderLink = (ui: React.ReactElement) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(<Router hook={hook}>{ui}</Router>);
};

describe("<BackLink>", () => {
  it("renders an anchor pointing at href", () => {
    renderLink(<BackLink href="/runs/run-1">back to run</BackLink>);
    const link = screen.getByRole("link", { name: /back to run/i });
    expect(link.getAttribute("href")).toBe("/runs/run-1");
  });

  it("prefixes the children with the back arrow glyph", () => {
    renderLink(<BackLink href="/">all activity</BackLink>);
    const link = screen.getByRole("link", { name: /all activity/i });
    expect(link.textContent).toBe("← all activity");
  });
});
