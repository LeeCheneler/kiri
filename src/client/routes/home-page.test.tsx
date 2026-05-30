import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HomeContent } from "./home-page.tsx";

const renderHomePage = () => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <HomeContent />
    </Router>,
  );
};

describe("<HomePage>", () => {
  it("anchors the page on the Activity breadcrumb", () => {
    renderHomePage();
    const current = screen.getByText("Activity");
    expect(current.getAttribute("aria-current")).toBe("page");
  });
});
