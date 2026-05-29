import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { StatusBlock } from "./status-block.tsx";

describe("<StatusBlock>", () => {
  it("wraps its children and exposes the status", () => {
    render(
      <StatusBlock status="failed">
        <p>step 3 exited with code 1</p>
      </StatusBlock>,
    );
    const block = screen.getByText("step 3 exited with code 1").closest("[data-status]");
    expect(block?.getAttribute("data-status")).toBe("failed");
  });
});
