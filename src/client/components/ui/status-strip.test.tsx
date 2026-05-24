import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { StatusStrip } from "./status-strip.tsx";

afterEach(() => cleanup());

describe("<StatusStrip>", () => {
  it("renders an element marked aria-hidden so assistive tech skips it", () => {
    const { container } = render(<StatusStrip status="ok" weight="header" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("tags the rendered element with the status via data-status", () => {
    const { container } = render(<StatusStrip status="failed" weight="row" />);
    expect(container.querySelector("[data-status='failed']")).not.toBeNull();
  });

  it("exposes the header weight via data-weight for size selection", () => {
    const { container } = render(<StatusStrip status="ok" weight="header" />);
    expect(container.querySelector("[data-weight='header']")).not.toBeNull();
  });

  it("exposes the row weight via data-weight for size selection", () => {
    const { container } = render(<StatusStrip status="ok" weight="row" />);
    expect(container.querySelector("[data-weight='row']")).not.toBeNull();
  });
});
