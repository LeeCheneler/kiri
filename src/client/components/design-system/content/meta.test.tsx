import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Meta } from "./meta.tsx";

describe("<Meta>", () => {
  it("renders each fact in the row", () => {
    render(
      <Meta>
        <span>3 steps</span>
        <span>2 inputs</span>
        <span>1 publish</span>
      </Meta>,
    );
    expect(screen.getByText("3 steps")).toBeDefined();
    expect(screen.getByText("2 inputs")).toBeDefined();
    expect(screen.getByText("1 publish")).toBeDefined();
  });
});
