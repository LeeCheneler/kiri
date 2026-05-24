import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { SectionHeader } from "./section-header.tsx";

afterEach(() => cleanup());

describe("<SectionHeader>", () => {
  it("renders the title as a heading", () => {
    render(<SectionHeader title="Activity" />);
    expect(screen.getByRole("heading", { name: "Activity" })).toBeDefined();
  });

  it("renders the meta string verbatim when supplied", () => {
    render(<SectionHeader title="Inputs" meta="3 inputs" />);
    expect(screen.getByText("3 inputs")).toBeDefined();
  });

  it("omits the meta element when meta is undefined", () => {
    const { container } = render(<SectionHeader title="Summary" />);
    expect(container.querySelector("span")).toBeNull();
  });

  it("threads headingId onto the heading element so aria-labelledby can target it", () => {
    render(<SectionHeader title="Activity" headingId="activity-heading" />);
    expect(screen.getByRole("heading", { name: "Activity" }).id).toBe("activity-heading");
  });
});
