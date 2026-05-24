import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { PulseDot } from "./pulse-dot.tsx";

afterEach(() => cleanup());

describe("<PulseDot>", () => {
  it("renders an element marked aria-hidden so assistive tech skips it", () => {
    render(<PulseDot />);
    const dot = screen.getByTestId("pulse-dot");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
  });
});
