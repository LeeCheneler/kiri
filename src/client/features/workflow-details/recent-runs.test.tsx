import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { RecentRuns } from "./recent-runs.tsx";

describe("<RecentRuns>", () => {
  it("renders the placeholder until the feed is rebuilt", () => {
    render(<RecentRuns />);
    expect(screen.getByText(/recent runs will appear here/i)).toBeDefined();
  });
});
