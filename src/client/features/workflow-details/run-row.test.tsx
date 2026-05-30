import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RunListEntry } from "../../api.ts";
import { RunRow } from "./run-row.tsx";

// A fixed clock so relative timestamps render deterministically: three
// minutes after the default `startedAt` below.
const NOW = new Date("2026-05-09T12:03:00.000Z");

const run = (over: Partial<RunListEntry> = {}): RunListEntry => ({
  id: "r1",
  workflowName: "deploy",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.400Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: "deploy", steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  ...over,
});

const renderRow = (entry: RunListEntry) => {
  const { hook } = memoryLocation({ path: "/workflows/deploy" });
  return render(
    <Router hook={hook}>
      <RunRow run={entry} now={NOW} />
    </Router>,
  );
};

describe("<RunRow>", () => {
  it("renders the status, short run id, relative start time, and duration in the byline", () => {
    renderRow(run({ status: "ok" }));
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.getByRole("link", { name: "r1" }).getAttribute("href")).toBe("/runs/r1");
    expect(screen.getByText("3 minutes ago")).toBeDefined();
    expect(screen.getByText("1.4s")).toBeDefined();
  });

  it("omits the duration for a run still in flight", () => {
    renderRow(run({ status: "running", finishedAt: null }));
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.queryByText("1.4s")).toBeNull();
  });

  it("links the run detail from the short run id, leaving the time as plain text", () => {
    renderRow(run({ id: "abc" }));
    const anchor = screen.getByRole("link", { name: "abc" });
    expect(anchor.getAttribute("href")).toBe("/runs/abc");
    // The relative start time is a plain meta fact now, not the link.
    expect(screen.queryByRole("link", { name: "3 minutes ago" })).toBeNull();
  });

  it("omits the redundant workflow name", () => {
    renderRow(run({ workflowName: "deploy" }));
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("renders the summary when present", () => {
    renderRow(run({ summary: "Deployed cleanly to production." }));
    expect(screen.getByText(/deployed cleanly to production/i)).toBeDefined();
  });

  it("renders no summary when absent", () => {
    renderRow(run({ summary: null }));
    expect(screen.queryByText(/deployed/i)).toBeNull();
  });

  it("lists published articles with the name as eyebrow and the first heading as the link", () => {
    renderRow(
      run({
        id: "r2",
        articles: [
          { name: "digest", title: "PR Review Digest", heading: "Findings", createdAt: "" },
        ],
      }),
    );
    expect(screen.getByText("digest")).toBeDefined();
    const link = screen.getByRole("link", { name: "Findings" });
    expect(link.getAttribute("href")).toBe("/runs/r2/published/digest");
  });

  it("falls back to the article title when it has no extracted heading", () => {
    renderRow(
      run({
        articles: [{ name: "digest", title: "PR Review Digest", heading: null, createdAt: "" }],
      }),
    );
    expect(screen.getByRole("link", { name: "PR Review Digest" })).toBeDefined();
  });

  it("renders no article list when the run published nothing", () => {
    renderRow(run({ articles: [] }));
    expect(screen.queryByText("digest")).toBeNull();
  });
});
