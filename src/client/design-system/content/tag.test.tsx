import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Tag } from "./tag.tsx";

describe("<Tag>", () => {
  it("renders its label", () => {
    render(<Tag>dirty</Tag>);
    expect(screen.getByText("dirty")).toBeDefined();
  });

  it("defaults to the neutral tone exposed via data-tone", () => {
    const { container } = render(<Tag>locked</Tag>);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  it("reflects the requested tone via data-tone", () => {
    const { container } = render(<Tag tone="negative">prunable</Tag>);
    expect(container.querySelector('[data-tone="negative"]')).not.toBeNull();
  });
});
