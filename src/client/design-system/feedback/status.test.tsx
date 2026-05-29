import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Status, type StatusKind } from "./status.tsx";

const ALL: StatusKind[] = ["pending", "running", "ok", "failed", "cancelled", "interrupted"];

describe("<Status>", () => {
  it("renders each state as its word with a data-status anchor", () => {
    render(ALL.map((status) => <Status key={status} status={status} />));
    for (const status of ALL) {
      expect(screen.getByText(status).getAttribute("data-status")).toBe(status);
    }
  });

  it("shows a decorative pulse cue for running and not for other states", () => {
    const { rerender } = render(<Status status="running" />);
    expect(screen.getByText("running").querySelector('[aria-hidden="true"]')).not.toBeNull();

    rerender(<Status status="ok" />);
    expect(screen.getByText("ok").querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
