import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { LabelledBlock } from "./labelled-block.tsx";

describe("<LabelledBlock>", () => {
  it("renders the label as a heading", () => {
    render(<LabelledBlock label="stdout">body</LabelledBlock>);
    expect(screen.getByRole("heading", { name: "stdout" })).toBeDefined();
  });

  it("renders the children inside the block", () => {
    render(
      <LabelledBlock label="description">
        <p>some prose</p>
      </LabelledBlock>,
    );
    expect(screen.getByText("some prose")).toBeDefined();
  });

  it("preserves the element type of children (caller owns inner styling)", () => {
    render(
      <LabelledBlock label="source">
        <pre>code</pre>
      </LabelledBlock>,
    );
    expect(screen.getByText("code").tagName).toBe("PRE");
  });

  it('defaults the tone to "default" and exposes it via data-tone', () => {
    const { container } = render(<LabelledBlock label="env">body</LabelledBlock>);
    expect(container.querySelector('[data-tone="default"]')).not.toBeNull();
  });

  it('reflects an explicit "danger" tone via data-tone', () => {
    const { container } = render(
      <LabelledBlock label="error" tone="danger">
        boom
      </LabelledBlock>,
    );
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
  });
});
