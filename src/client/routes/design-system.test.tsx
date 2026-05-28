import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DesignSystem } from "./design-system.tsx";

describe("<DesignSystem>", () => {
  it("renders the design system page heading", () => {
    const { hook } = memoryLocation({ path: "/dev/design-system" });
    render(
      <Router hook={hook}>
        <DesignSystem />
      </Router>,
    );
    expect(screen.getByRole("heading", { name: /design system/i })).toBeDefined();
  });
});
