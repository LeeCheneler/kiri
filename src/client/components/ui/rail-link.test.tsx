import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RailLink } from "./rail-link.tsx";

const renderLink = (ui: React.ReactElement) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(<Router hook={hook}>{ui}</Router>);
};

describe("<RailLink>", () => {
  it("renders an internal link routed through wouter", () => {
    renderLink(<RailLink href="/workflows/alpha">alpha</RailLink>);
    const link = screen.getByRole("link", { name: /alpha/i });
    expect(link.getAttribute("href")).toBe("/workflows/alpha");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("marks the row with aria-current='page' when active", () => {
    renderLink(
      <RailLink href="/workflows/alpha" active>
        alpha
      </RailLink>,
    );
    expect(screen.getByRole("link").getAttribute("aria-current")).toBe("page");
  });

  it("omits aria-current when inactive", () => {
    renderLink(<RailLink href="/workflows/alpha">alpha</RailLink>);
    expect(screen.getByRole("link").getAttribute("aria-current")).toBeNull();
  });

  it("renders permissive children so a meta sub-line can be stacked", () => {
    renderLink(
      <RailLink href="/runs/run-1/published/digest">
        <span>PR Review Digest</span>
        <span>pr-review · 5m ago</span>
      </RailLink>,
    );
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("PR Review Digest");
    expect(link.textContent).toContain("pr-review · 5m ago");
  });

  it("renders a native anchor with target/rel safety when external", () => {
    renderLink(
      <RailLink href="https://example.test/docs" external>
        Documentation
      </RailLink>,
    );
    const link = screen.getByRole("link", { name: /documentation/i });
    expect(link.getAttribute("href")).toBe("https://example.test/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("ignores active on external links since they're never the current page", () => {
    renderLink(
      <RailLink href="https://example.test" external active>
        Documentation
      </RailLink>,
    );
    expect(screen.getByRole("link").getAttribute("aria-current")).toBeNull();
  });
});
