import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { NavList } from "./nav-list.tsx";

const renderNav = () => {
  const { hook } = memoryLocation({ path: "/" });
  render(
    <Router hook={hook}>
      <NavList
        heading="Workflows"
        items={[
          { label: "pr-review", href: "/workflows/pr-review", active: true },
          { label: "nightly", href: "/workflows/nightly" },
          { label: "Documentation", href: "https://example.com/docs", external: true },
        ]}
      />
    </Router>,
  );
};

describe("<NavList>", () => {
  it("labels the navigation with its heading", () => {
    renderNav();
    expect(screen.getByRole("navigation", { name: "Workflows" })).toBeDefined();
  });

  it("renders internal items as wouter links to their href", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "pr-review" }).getAttribute("href")).toBe(
      "/workflows/pr-review",
    );
    expect(screen.getByRole("link", { name: "nightly" }).getAttribute("href")).toBe(
      "/workflows/nightly",
    );
  });

  it("marks the active internal item aria-current and leaves the rest unmarked", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "pr-review" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "nightly" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens external items in a new tab with a safe rel and never marks them current", () => {
    renderNav();
    const docs = screen.getByRole("link", { name: "Documentation" });
    expect(docs.getAttribute("target")).toBe("_blank");
    expect(docs.getAttribute("rel")).toBe("noreferrer noopener");
    expect(docs.getAttribute("aria-current")).toBeNull();
  });

  it("renders the empty state in place of the list when there are no items", () => {
    render(<NavList heading="Workflows" items={[]} emptyState={<p>no workflows yet</p>} />);
    expect(screen.getByText("no workflows yet")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
