import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunDetailRun, RunStepRow } from "../../api.ts";
import { RunPhases } from "./run-phases.tsx";

const NOW = new Date("2026-05-09T12:00:30.000Z");

const makeRun = (snapshot: RunDetailRun["definitionSnapshot"]): RunDetailRun => ({
  id: "run-1",
  workflowName: "wf",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:30.000Z",
  error: null,
  summary: null,
  definitionSnapshot: snapshot,
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
  recommendations: [],
});

const makeStep = (overrides: Partial<RunStepRow> & { index: number }): RunStepRow => ({
  id: `step-${overrides.index}`,
  runId: "run-1",
  kind: "use",
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:12.000Z",
  output: null,
  error: null,
  traces: { stdout: "", stderr: "", durationMs: 12000 },
  isSummary: false,
  isPublish: false,
  ...overrides,
});

describe("<RunPhases>", () => {
  it("renders declared phases as Steps, Publishes, and Summarise groups", () => {
    const longSh = "echo this-is-a-long-inline-command-that-comfortably-exceeds-sixty-characters";
    const run = makeRun({
      name: "wf",
      steps: [{ use: "fetch-pr" }, { sh: longSh }],
      publish: [{ name: "digest", title: "PR Digest", use: "writer" }],
      summarize: { use: "summariser" },
    });
    const steps = [
      makeStep({ index: 0 }),
      makeStep({ index: 1, kind: "sh" }),
      makeStep({ index: 2, isPublish: true }),
      makeStep({ index: 3, isSummary: true }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Publishes")).toBeDefined();
    expect(screen.getByText("Summarise")).toBeDefined();
    expect(screen.getByText("use: fetch-pr")).toBeDefined();
    // A long inline shell is previewed and truncated with an ellipsis.
    expect(screen.getByText(/^sh: echo this-is-a-long.*…$/)).toBeDefined();
    expect(screen.getByText("PR Digest")).toBeDefined();
    expect(screen.getByText("use: summariser")).toBeDefined();
  });

  it("labels a step by its name when one is declared", () => {
    const run = makeRun({
      name: "wf",
      steps: [{ sh: "echo hi\necho bye", name: "Warm the cache" }],
    });
    render(<RunPhases run={run} steps={[makeStep({ index: 0, kind: "sh" })]} now={NOW} />);
    expect(screen.getByText("Warm the cache")).toBeDefined();
    expect(screen.queryByText(/^sh:/)).toBeNull();
  });

  it("expands an executed step to reveal stdout and an empty stderr", async () => {
    const user = userEvent.setup();
    const run = makeRun({ name: "wf", steps: [{ use: "fetch-pr" }] });
    const steps = [
      makeStep({ index: 0, traces: { stdout: "hello stdout", stderr: "", durationMs: 12000 } }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /fetch-pr/i }));

    expect(screen.getByText("hello stdout")).toBeDefined();
    expect(screen.getByText("(empty)")).toBeDefined();
  });

  it("times a running step live and marks a not-yet-run step pending", () => {
    const run = makeRun({
      name: "wf",
      steps: [{ use: "fetch" }, { use: "build" }, { use: "deploy" }],
    });
    const steps = [
      makeStep({ index: 0 }),
      makeStep({
        index: 1,
        status: "running",
        startedAt: "2026-05-09T12:00:18.000Z",
        finishedAt: null,
      }),
      // index 2 has no row — the runner hasn't reached it.
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);

    expect(screen.getByText("running")).toBeDefined();
    // The not-yet-run step is pending: a static row (no expand affordance) with
    // a dash for its duration.
    expect(screen.getByText("use: deploy")).toBeDefined();
    expect(screen.getByText("pending")).toBeDefined();
    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
    expect(screen.getByText("—")).toBeDefined();
  });

  it("surfaces a failed step's error message, with the stack when present", async () => {
    const user = userEvent.setup();
    const run = makeRun({ name: "wf", steps: [{ use: "build" }, { use: "test" }] });
    const steps = [
      makeStep({ index: 0, status: "failed", error: { message: "boom", stack: "at build" } }),
      makeStep({ index: 1, status: "failed", error: { message: "splat" } }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);

    await user.click(screen.getByRole("button", { name: /build/i }));
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("at build")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /test/i }));
    expect(screen.getByText("splat")).toBeDefined();
  });
});
