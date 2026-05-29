import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Rule } from "./rule.tsx";

describe("<Rule>", () => {
  it("renders a separator", () => {
    render(<Rule />);
    expect(screen.getByRole("separator")).toBeDefined();
  });
});
