import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { RunDetailRun } from "../../api.ts";
import { RunHeader } from "./run-header.tsx";

const NOW = new Date("2026-05-09T12:05:00.000Z");

const makeRun = (overrides: Partial<RunDetailRun> = {}): RunDetailRun => ({
  id: "abcd1234efgh5678",
  workflowName: "pr-review",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:42.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "pr-review", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  recommendations: [],
  ...overrides,
});

describe("<RunHeader>", () => {
  it("renders the workflow eyebrow, short-id heading, and a finished byline", () => {
    render(<RunHeader run={makeRun()} now={NOW} />);

    expect(screen.getByText("pr-review · Run")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "abcd1234" })).toBeDefined();
    expect(screen.getByText("ok")).toBeDefined();
    // Final span from start → finish (42s); no deleted marker on a live workflow.
    expect(screen.getByText("42s")).toBeDefined();
    expect(screen.queryByText("deleted")).toBeNull();
  });

  it("shows a live elapsed timer in place of a final duration while running", () => {
    render(<RunHeader run={makeRun({ status: "running", finishedAt: null })} now={NOW} />);

    expect(screen.getByText("running")).toBeDefined();
    // now − startedAt = 5 minutes, ticking from startedAt.
    expect(screen.getByText("5m")).toBeDefined();
  });

  it("marks a run whose workflow is no longer in the registry as deleted", () => {
    render(<RunHeader run={makeRun({ isInterrupted: true })} now={NOW} />);

    expect(screen.getByText("deleted")).toBeDefined();
  });

  it("renders header actions beside the heading when provided", () => {
    render(
      <RunHeader run={makeRun()} now={NOW} actions={<button type="button">do thing</button>} />,
    );

    expect(screen.getByRole("button", { name: "do thing" })).toBeDefined();
  });
});
