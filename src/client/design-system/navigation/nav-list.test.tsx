import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { NavList } from "./nav-list.tsx";

const renderNav = (ui: ReactNode) => {
  const { hook } = memoryLocation({ path: "/" });
  render(<Router hook={hook}>{ui}</Router>);
};

const renderFlat = () =>
  renderNav(
    <NavList
      heading="Workflows"
      items={[
        { label: "pr-review", href: "/workflows/pr-review", active: true },
        { label: "nightly", href: "/workflows/nightly" },
        { label: "Documentation", href: "https://example.com/docs" },
      ]}
    />,
  );

const renderGrouped = () =>
  renderNav(
    <NavList
      heading="Workflows"
      items={[
        { label: "hello-world", href: "/workflows/hello-world" },
        {
          heading: "Dev",
          items: [
            { label: "lint", href: "/workflows/lint" },
            { label: "test", href: "/workflows/test", active: true },
          ],
        },
        { label: "restore", href: "/workflows/restore" },
      ]}
    />,
  );

describe("<NavList>", () => {
  it("labels the navigation with its heading", () => {
    renderFlat();
    expect(screen.getByRole("navigation", { name: "Workflows" })).toBeDefined();
  });

  it("renders internal items as in-app wouter links to their href", () => {
    renderFlat();
    const prReview = screen.getByRole("link", { name: "pr-review" });
    expect(prReview.getAttribute("href")).toBe("/workflows/pr-review");
    // An in-app path stays in the tab — no external target.
    expect(prReview.getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "nightly" }).getAttribute("href")).toBe(
      "/workflows/nightly",
    );
  });

  it("marks the active internal item aria-current and leaves the rest unmarked", () => {
    renderFlat();
    expect(screen.getByRole("link", { name: "pr-review" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "nightly" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens a row whose href leaves the app in a new tab with a safe rel, never current", () => {
    renderFlat();
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

  it("renders rows and groups in one ordered items list as links", () => {
    renderGrouped();
    expect(screen.getByRole("link", { name: "hello-world" }).getAttribute("href")).toBe(
      "/workflows/hello-world",
    );
    expect(screen.getByRole("link", { name: "lint" }).getAttribute("href")).toBe("/workflows/lint");
    expect(screen.getByRole("link", { name: "test" }).getAttribute("href")).toBe("/workflows/test");
    expect(screen.getByRole("link", { name: "restore" }).getAttribute("href")).toBe(
      "/workflows/restore",
    );
  });

  it("titles each group with a sub-heading", () => {
    renderGrouped();
    expect(screen.getByRole("heading", { name: "Dev" })).toBeDefined();
  });

  it("marks the active row aria-current even when it lives inside a group", () => {
    renderGrouped();
    expect(screen.getByRole("link", { name: "test" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "lint" }).getAttribute("aria-current")).toBeNull();
  });

  it("renders groups, not the empty state, when only groups are present", () => {
    renderNav(
      <NavList
        heading="Workflows"
        items={[{ heading: "Dev", items: [{ label: "lint", href: "/workflows/lint" }] }]}
        emptyState={<p>no workflows yet</p>}
      />,
    );
    expect(screen.queryByText("no workflows yet")).toBeNull();
    expect(screen.getByRole("link", { name: "lint" })).toBeDefined();
  });

  it("renders a bare row cluster with no nav landmark when no heading is given", () => {
    renderNav(<NavList items={[{ label: "Home", href: "/", active: true }]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  });
});
