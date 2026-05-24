import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusLabel } from "./status-label.tsx";

afterEach(() => cleanup());

describe("<StatusLabel>", () => {
  it("renders the status keyword as text", () => {
    render(<StatusLabel status="failed" />);
    expect(screen.getByText("failed")).toBeDefined();
  });

  it("tags the rendered element with the status via data-status", () => {
    const { container } = render(<StatusLabel status="cancelled" />);
    expect(container.querySelector("[data-status='cancelled']")).not.toBeNull();
  });

  it("renders the running keyword by default when status is running", () => {
    render(<StatusLabel status="running" />);
    expect(screen.getByText("running")).toBeDefined();
  });

  it("renders a pulse dot beside the word when running", () => {
    render(<StatusLabel status="running" />);
    expect(screen.getByTestId("pulse-dot")).toBeDefined();
  });

  it("does not render a pulse dot for non-running statuses", () => {
    render(<StatusLabel status="ok" />);
    expect(screen.queryByTestId("pulse-dot")).toBeNull();
  });

  it("renders runningLabel in place of the keyword for the running status", () => {
    render(<StatusLabel status="running" runningLabel="in flight" />);
    expect(screen.getByText("in flight")).toBeDefined();
    expect(screen.queryByText("running")).toBeNull();
  });

  it("ignores runningLabel for non-running statuses", () => {
    render(<StatusLabel status="ok" runningLabel="in flight" />);
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.queryByText("in flight")).toBeNull();
  });
});
