import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EdgedBlock } from "./edged-block.tsx";

describe("<EdgedBlock>", () => {
  it("wraps its children behind an anchorable edge", () => {
    render(
      <EdgedBlock>
        <p>Tuesday briefing</p>
      </EdgedBlock>,
    );
    const block = screen.getByText("Tuesday briefing").closest("[data-edge]");
    expect(block?.getAttribute("data-edge")).toBe("accent");
  });
});
