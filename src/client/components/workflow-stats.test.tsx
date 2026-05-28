import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { WorkflowStats } from "./workflow-stats.tsx";

const WORKFLOW = "dev-patch";
const STARTED = "2026-05-09T12:00:00.000Z";

// One run row as the API returns it. `durMs` sets the finish offset from
// `STARTED`; pass `durMs: null` for an in-flight run with no finish.
const run = (
  overrides: { id: string; status?: string; durMs?: number | null; articles?: number } & Record<
    string,
    unknown
  >,
) => {
  const { durMs = 1000, articles = 0, status = "ok", ...rest } = overrides;
  const finishedAt =
    durMs === null ? null : new Date(new Date(STARTED).getTime() + durMs).toISOString();
  return {
    workflowName: WORKFLOW,
    status,
    startedAt: STARTED,
    finishedAt,
    error: null,
    summary: null,
    definitionSnapshot: { name: WORKFLOW, steps: [] },
    gitSha: null,
    gitDirty: null,
    inputs: null,
    isInterrupted: false,
    articles: Array.from({ length: articles }, (_, i) => ({
      name: `a${i}`,
      title: `A${i}`,
      heading: null,
      createdAt: STARTED,
    })),
    recommendationsCount: 0,
    ...rest,
  };
};

// 14-run window (newest first, as the API returns it): 12 ok, 2 failed.
// Durations are 1000ms apart from two outliers — r1 at 5000ms and a
// failed r12 at 3000ms — so the window median is 1000ms. Articles sum to
// 5 (r1: 3, r14: 2).
const window14 = () => [
  run({ id: "r1", durMs: 5000, articles: 3 }),
  run({ id: "r2" }),
  run({ id: "r3" }),
  run({ id: "r4" }),
  run({ id: "r5" }),
  run({ id: "r6" }),
  run({ id: "r7" }),
  run({ id: "r8" }),
  run({ id: "r9" }),
  run({ id: "r10" }),
  run({ id: "r11" }),
  run({ id: "r12", status: "failed", durMs: 3000 }),
  run({ id: "r13", status: "failed" }),
  run({ id: "r14", articles: 2 }),
];

const serveRuns = (runs: unknown[]) =>
  server.use(http.get("*/api/runs", () => HttpResponse.json({ runs, nextCursor: null })));

const renderStats = () => render(<WorkflowStats workflowName={WORKFLOW} />);

describe("<WorkflowStats>", () => {
  it("shows a loading message while the snapshot is in flight", () => {
    server.use(http.get("*/api/runs", () => new Promise(() => {})));
    renderStats();
    expect(screen.getByText(/loading run stats/i)).toBeDefined();
  });

  it("renders the panel heading", async () => {
    renderStats();
    expect(screen.getByRole("heading", { name: /last 14 runs/i })).toBeDefined();
    // Let the default (empty) snapshot fetch settle inside act.
    await screen.findByText(/no runs to chart yet/i);
  });

  it("shows an empty-state line and no bars when the workflow has no runs", async () => {
    serveRuns([]);
    const { container } = renderStats();
    expect(await screen.findByText(/no runs to chart yet/i)).toBeDefined();
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(0);
  });

  it("surfaces a fetch failure via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderStats();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/failed to load run stats/i);
  });

  it("scopes the snapshot fetch to its workflow and the 14-run window", async () => {
    let seen: URLSearchParams | undefined;
    server.use(
      http.get("*/api/runs", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ runs: [], nextCursor: null });
      }),
    );
    renderStats();
    await screen.findByText(/no runs to chart yet/i);
    expect(seen?.get("workflow")).toBe(WORKFLOW);
    expect(seen?.get("limit")).toBe("14");
  });

  it("aggregates runs, ok, failed, articles, and average duration over the window", async () => {
    serveRuns(window14());
    renderStats();

    expect(await screen.findByText("14")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    // (5000 + 3000 + 12×1000) / 14 = 1428ms → "1.4s".
    expect(screen.getByText("1.4s")).toBeDefined();
  });

  it("renders one sparkline bar per run in the window", async () => {
    serveRuns(window14());
    const { container } = renderStats();
    await screen.findByText("14");
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(14);
  });

  it("tints runs slower than the window median warm and leaves the rest ok", async () => {
    serveRuns(window14());
    const { container } = renderStats();
    await screen.findByText("14");
    // Only r1 (5000ms) exceeds the 1000ms median among the ok runs.
    expect(container.querySelectorAll('[data-tone="warm"]')).toHaveLength(1);
    // 14 total − 1 warm − 2 failed = 11 ok bars.
    expect(container.querySelectorAll('[data-tone="ok"]')).toHaveLength(11);
  });

  it("tints failed runs with the failed tone regardless of duration", async () => {
    serveRuns(window14());
    const { container } = renderStats();
    await screen.findByText("14");
    // r12 (3000ms, above median) and r13 (1000ms, at median) are both failed.
    expect(container.querySelectorAll('[data-tone="failed"]')).toHaveLength(2);
  });

  it("handles a window of only in-flight runs without a duration", async () => {
    serveRuns([run({ id: "r1", status: "running", durMs: null })]);
    const { container } = renderStats();

    expect(await screen.findByText("0ms")).toBeDefined();
    const bars = container.querySelectorAll("[data-tone]");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.getAttribute("data-tone")).toBe("ok");
    expect(bars[0]?.getAttribute("title")).toBe("in progress");
  });

  it("settles the on-mount fetch without an act warning", async () => {
    serveRuns(window14());
    renderStats();
    await waitFor(() => expect(screen.getByText("14")).toBeDefined());
  });
});
