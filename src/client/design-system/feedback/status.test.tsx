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

  it("stands children in for the word, keeping the state's dot and anchor", () => {
    render(<Status status="waiting">worker waiting</Status>);
    const badge = screen.getByText("worker waiting");
    expect(badge.getAttribute("data-status")).toBe("waiting");
    // Waiting is a live state, so the label keeps its pulse cue.
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
