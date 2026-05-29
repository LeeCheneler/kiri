import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { InlineLink } from "./inline-link.tsx";

describe("<InlineLink>", () => {
  it("renders an internal link that stays in-app", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <InlineLink href="/workflows/daily">the daily workflow</InlineLink>
      </Router>,
    );
    const link = screen.getByRole("link", { name: /the daily workflow/i });
    expect(link.getAttribute("href")).toBe("/workflows/daily");
    expect(link.getAttribute("target")).toBeNull();
    expect(link.textContent).not.toContain("↗");
  });

  it("opens external links in a new tab with a safe rel", () => {
    render(<InlineLink href="https://example.com">an external source</InlineLink>);
    const link = screen.getByRole("link", { name: /an external source/i });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link.textContent).toContain("↗");
  });

  it("renders a fragment link as a same-page anchor", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <InlineLink href="#section-01">jump to section</InlineLink>
      </Router>,
    );
    const link = screen.getByRole("link", { name: /jump to section/i });
    expect(link.getAttribute("href")).toBe("#section-01");
    expect(link.getAttribute("target")).toBeNull();
    expect(link.textContent).not.toContain("↗");
  });
});
