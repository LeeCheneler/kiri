import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state.tsx";

describe("<EmptyState>", () => {
  it("renders its children as paragraph text", () => {
    render(<EmptyState>no runs yet.</EmptyState>);
    expect(screen.getByText("no runs yet.")).toBeDefined();
  });

  it("renders inline children alongside surrounding text", () => {
    render(
      <EmptyState>
        run <code>kiri init</code> first.
      </EmptyState>,
    );
    expect(screen.getByText("kiri init").tagName).toBe("CODE");
  });
});
