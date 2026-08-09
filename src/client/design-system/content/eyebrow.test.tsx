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

  it("reflects the faint tone for labels nested inside a row", () => {
    render(<Eyebrow tone="faint">2 articles</Eyebrow>);
    expect(screen.getByText("2 articles").getAttribute("data-tone")).toBe("faint");
  });
});
