import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Meter } from "./meter.tsx";

describe("<Meter>", () => {
  it("exposes the fill as a named meter with its value and bounds", () => {
    render(<Meter value={27_393} max={1_048_576} label="Context used" />);
    const meter = screen.getByRole("meter", { name: "Context used" });
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("1048576");
    expect(meter.getAttribute("aria-valuenow")).toBe("27393");
  });

  it("clamps an overflowing value to the maximum", () => {
    render(<Meter value={250} max={200} label="Quota" />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("200");
  });

  it("treats a zero maximum as empty rather than dividing by zero", () => {
    render(<Meter value={5} max={0} label="Quota" />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("0");
  });

  it("defaults to the accent tone and surfaces an escalated tone via data-tone", () => {
    const { rerender } = render(<Meter value={1} max={10} label="Quota" />);
    expect(screen.getByRole("meter").getAttribute("data-tone")).toBe("accent");
    rerender(<Meter value={9} max={10} label="Quota" tone="warning" />);
    expect(screen.getByRole("meter").getAttribute("data-tone")).toBe("warning");
    rerender(<Meter value={10} max={10} label="Quota" tone="negative" />);
    expect(screen.getByRole("meter").getAttribute("data-tone")).toBe("negative");
  });
});
