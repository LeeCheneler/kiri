import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Breadcrumb } from "./breadcrumb.tsx";

const renderCrumb = () => {
  const { hook } = memoryLocation({ path: "/" });
  render(
    <Router hook={hook}>
      <Breadcrumb
        items={[
          { label: "Workflows", href: "/workflows" },
          { label: "pr-review", href: "/workflows/pr-review" },
        ]}
        current="run 42"
      />
    </Router>,
  );
};

describe("<Breadcrumb>", () => {
  it("renders a labelled breadcrumb navigation", () => {
    renderCrumb();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeDefined();
  });

  it("renders each ancestor as a link to its href", () => {
    renderCrumb();
    expect(screen.getByRole("link", { name: "Workflows" }).getAttribute("href")).toBe("/workflows");
    expect(screen.getByRole("link", { name: "pr-review" }).getAttribute("href")).toBe(
      "/workflows/pr-review",
    );
  });

  it("renders the current page as text marked aria-current, not a link", () => {
    renderCrumb();
    expect(screen.queryByRole("link", { name: "run 42" })).toBeNull();
    expect(screen.getByText("run 42").getAttribute("aria-current")).toBe("page");
  });
});
