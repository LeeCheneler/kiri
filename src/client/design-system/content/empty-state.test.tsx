import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state.tsx";

describe("<EmptyState>", () => {
  it("renders its message", () => {
    render(<EmptyState>no runs yet</EmptyState>);
    expect(screen.getByText("no runs yet")).toBeDefined();
  });
});
