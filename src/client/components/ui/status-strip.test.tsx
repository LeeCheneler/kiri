import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { StatusStrip } from "./status-strip.tsx";

describe("<StatusStrip>", () => {
  it("renders an element marked aria-hidden so assistive tech skips it", () => {
    const { container } = render(<StatusStrip status="ok" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
