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

const renderRow = (entry: RunListEntry, opts: { nameBy?: "workflow" | "time" } = {}) => {
  const { hook } = memoryLocation({ path: "/workflows/deploy" });
  return render(
    <Router hook={hook}>
      <RunRow run={entry} now={NOW} nameBy={opts.nameBy} />
    </Router>,
  );
};

describe("<RunRow>", () => {
  it("renders the status, relative start time, and duration in the byline", () => {
    renderRow(run({ status: "ok" }));
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.getByText("3 minutes ago")).toBeDefined();
    expect(screen.getByText("1.4s")).toBeDefined();
  });

  it("omits the duration for a run still in flight", () => {
    renderRow(run({ status: "running", finishedAt: null }));
    expect(screen.getByText("running")).toBeDefined();
    expect(screen.queryByText("1.4s")).toBeNull();
  });

  it("never surfaces the run id, which addresses a run rather than naming one", () => {
    renderRow(run({ id: "abcd1234-5678" }));
    expect(screen.queryByText(/abcd1234/)).toBeNull();
  });

  it("names a run by when it ran on a single workflow's page", () => {
    renderRow(run({ id: "abc", workflowName: "deploy" }));
    const anchor = screen.getByRole("link", { name: /12:00/ });
    expect(anchor.getAttribute("href")).toBe("/runs/abc");
    // Every row there would otherwise read "deploy".
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("names a run by its workflow in the blended feed", () => {
    renderRow(run({ id: "abc", workflowName: "deploy" }), { nameBy: "workflow" });
    const anchor = screen.getByRole("link", { name: /deploy/ });
    expect(anchor.getAttribute("href")).toBe("/runs/abc");
  });

  it("surfaces a pluralised recommendation count when the run produced any", () => {
    renderRow(run({ recommendationsCount: 11 }));
    expect(screen.getByText("11 recommendations")).toBeDefined();
  });

  it("renders the recommendation count in the singular for exactly one", () => {
    renderRow(run({ recommendationsCount: 1 }));
    expect(screen.getByText("1 recommendation")).toBeDefined();
  });

  it("omits the recommendation count when the run produced none", () => {
    renderRow(run({ recommendationsCount: 0 }));
    expect(screen.queryByText(/recommendation/i)).toBeNull();
  });

  it("renders the summary when present", () => {
    renderRow(run({ summary: "Deployed cleanly to production." }));
    expect(screen.getByText(/deployed cleanly to production/i)).toBeDefined();
  });

  it("renders no summary when absent", () => {
    renderRow(run({ summary: null }));
    expect(screen.queryByText(/deployed/i)).toBeNull();
  });

  it("lists the articles as links carrying the first heading, without the slug", () => {
    renderRow(
      run({
        id: "r2",
        articles: [
          { slug: "digest", name: "PR Review Digest", heading: "Findings", createdAt: "" },
        ],
      }),
    );
    const link = screen.getByRole("link", { name: "Findings" });
    expect(link.getAttribute("href")).toBe("/runs/r2/articles/digest");
    // The slug is plumbing, not a label — the title link stands alone.
    expect(screen.queryByText("digest")).toBeNull();
  });

  it("falls back to the article name when it has no extracted heading", () => {
    renderRow(
      run({
        articles: [{ slug: "digest", name: "PR Review Digest", heading: null, createdAt: "" }],
      }),
    );
    expect(screen.getByRole("link", { name: "PR Review Digest" })).toBeDefined();
  });

  it("renders no article list when the run produced nothing", () => {
    renderRow(run({ articles: [] }));
    expect(screen.queryByText("digest")).toBeNull();
  });
});
