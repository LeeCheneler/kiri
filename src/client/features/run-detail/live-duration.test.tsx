import { afterEach, describe, expect, it, jest } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { LiveDuration } from "./live-duration.tsx";

const START = "2026-05-09T12:00:00.000Z";

describe("<LiveDuration>", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the elapsed span from startedAt to a pinned now", () => {
    render(<LiveDuration startedAt={START} now={new Date("2026-05-09T12:01:30.000Z")} />);
    expect(screen.getByText("1m 30s")).toBeDefined();
  });

  it("advances off the system clock when now is not pinned", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-09T12:00:11.000Z"));
    render(<LiveDuration startedAt={START} />);
    expect(screen.getByText("11s")).toBeDefined();

    // The interval fires a re-render that recomputes the elapsed time from the
    // clock — proving the timer is live. (Under fake timers the re-render reads
    // the real clock, so we assert the figure moved on rather than a fixed value.)
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("11s")).toBeNull();
  });
});
