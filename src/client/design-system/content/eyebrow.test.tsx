import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Eyebrow } from "./eyebrow.tsx";

describe("<Eyebrow>", () => {
  it("renders its children as an accent kicker by default", () => {
    render(<Eyebrow>Dev · Workflow</Eyebrow>);
    const eyebrow = screen.getByText("Dev · Workflow");
    expect(eyebrow.getAttribute("data-tone")).toBe("accent");
  });

  it("reflects the muted tone for section-level labels", () => {
    render(<Eyebrow tone="muted">Steps</Eyebrow>);
    expect(screen.getByText("Steps").getAttribute("data-tone")).toBe("muted");
  });
});
