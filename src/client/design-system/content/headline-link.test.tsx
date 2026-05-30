import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HeadlineLink } from "./headline-link.tsx";

describe("<HeadlineLink>", () => {
  it("renders an internal link that stays in-app", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <HeadlineLink href="/runs/abc">Weekly Digest</HeadlineLink>
      </Router>,
    );
    const link = screen.getByRole("link", { name: /weekly digest/i });
    expect(link.getAttribute("href")).toBe("/runs/abc");
    expect(link.getAttribute("target")).toBeNull();
    expect(link.textContent).not.toContain("↗");
  });

  it("opens external links in a new tab with a safe rel and a trailing mark", () => {
    render(<HeadlineLink href="https://example.com">an external report</HeadlineLink>);
    const link = screen.getByRole("link", { name: /an external report/i });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link.textContent).toContain("↗");
  });
});
