import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { DesignSystem } from "./design-system.tsx";

describe("<DesignSystem>", () => {
  it("renders the design system page heading", () => {
    render(<DesignSystem />);
    expect(screen.getByRole("heading", { name: /design system/i })).toBeDefined();
  });
});
