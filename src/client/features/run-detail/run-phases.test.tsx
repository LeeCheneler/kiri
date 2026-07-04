import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunDetailRun, RunStepRow } from "../../api.ts";
import { RunPhases } from "./run-phases.tsx";

const NOW = new Date("2026-05-09T12:00:30.000Z");

const makeRun = (
  snapshot: RunDetailRun["definitionSnapshot"],
  over: Partial<RunDetailRun> = {},
): RunDetailRun => ({
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
  ...over,
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
  isArticle: false,
  ...overrides,
});

describe("<RunPhases>", () => {
  it("renders declared phases as Steps, Articles, and Summarise groups", () => {
    const longSh = "echo this-is-a-long-inline-command-that-comfortably-exceeds-sixty-characters";
    const run = makeRun({
      name: "wf",
      steps: [{ use: "fetch-pr" }, { sh: longSh }],
      articles: [{ slug: "digest", name: "PR Digest", use: "writer" }],
      summarize: { use: "summariser" },
    });
    const steps = [
      makeStep({ index: 0 }),
      makeStep({ index: 1, kind: "sh" }),
      makeStep({ index: 2, isArticle: true }),
      makeStep({ index: 3, isSummary: true }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);

    expect(screen.getByText("Steps")).toBeDefined();
    expect(screen.getByText("Articles")).toBeDefined();
    expect(screen.getByText("Summarise")).toBeDefined();
    expect(screen.getByText("fetch-pr")).toBeDefined();
    // A long inline shell is previewed and truncated with an ellipsis.
    expect(screen.getByText(/^echo this-is-a-long.*…$/)).toBeDefined();
    expect(screen.getByText("PR Digest")).toBeDefined();
    expect(screen.getByText("summariser")).toBeDefined();
  });

  it("shows a step's declared id beside its title", () => {
    const run = makeRun({ name: "wf", steps: [{ use: "fetch-pr", id: "fetch" }] });
    render(<RunPhases run={run} steps={[makeStep({ index: 0 })]} now={NOW} />);
    expect(screen.getByText("fetch-pr")).toBeDefined();
    expect(screen.getByText("fetch")).toBeDefined();
  });

  it("shows an article's slug beside its resolved name", () => {
    const run = makeRun({
      name: "wf",
      steps: [{ use: "fetch-pr" }],
      articles: [{ slug: "digest", name: "PR Digest", use: "writer" }],
    });
    const steps = [makeStep({ index: 0 }), makeStep({ index: 1, isArticle: true })];
    render(<RunPhases run={run} steps={steps} now={NOW} />);
    expect(screen.getByText("PR Digest")).toBeDefined();
    expect(screen.getByText("digest")).toBeDefined();
  });

  it("reveals a published article's link when its row is expanded", async () => {
    const user = userEvent.setup();
    const run = makeRun(
      {
        name: "wf",
        steps: [{ use: "fetch-pr" }],
        articles: [{ slug: "digest", name: "PR Digest", use: "writer" }],
      },
      {
        articles: [{ slug: "digest", name: "PR Digest", heading: "Findings", createdAt: "" }],
      },
    );
    const steps = [makeStep({ index: 0 }), makeStep({ index: 1, isArticle: true })];
    render(<RunPhases run={run} steps={steps} now={NOW} />);

    // The link lives in the expanded trace, not the collapsed row.
    expect(screen.queryByRole("link", { name: /read the article/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /pr digest/i }));

    const link = screen.getByRole("link", { name: /read the article/i });
    expect(link.getAttribute("href")).toBe("/runs/run-1/articles/digest");
  });

  it("shows no article link before the entry has published", () => {
    const run = makeRun({
      name: "wf",
      steps: [{ use: "fetch-pr" }],
      articles: [{ slug: "digest", name: "PR Digest", use: "writer" }],
    });
    render(<RunPhases run={run} steps={[makeStep({ index: 0 })]} now={NOW} />);
    expect(screen.queryByRole("link", { name: /read the article/i })).toBeNull();
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
    expect(screen.getByText("deploy")).toBeDefined();
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

  it("expands an llm step to reveal its model, prompt, and token counts", async () => {
    const user = userEvent.setup();
    const run = makeRun({
      name: "wf",
      steps: [
        {
          llm: { model: "anthropic:claude-haiku-4-5", prompt: "Summarise the run." },
          name: "Draft summary",
        },
      ],
    });
    const steps = [
      makeStep({
        index: 0,
        kind: "llm",
        traces: {
          stdout: "a tidy summary",
          stderr: "",
          durationMs: 1400,
          usage: { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 },
        },
      }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /draft summary/i }));

    expect(screen.getByText("anthropic:claude-haiku-4-5")).toBeDefined();
    expect(screen.getByText("Summarise the run.")).toBeDefined();
    expect(screen.getByText("1200")).toBeDefined();
    expect(screen.getByText("340")).toBeDefined();
    expect(screen.getByText("1540")).toBeDefined();
  });

  it("shows an llm step's prompt file and omits token counts when usage is absent", async () => {
    const user = userEvent.setup();
    const run = makeRun({
      name: "wf",
      steps: [
        { llm: { model: "local:llama3", prompt_file: "prompts/review.tpl" }, name: "Review" },
      ],
    });
    const steps = [
      makeStep({ index: 0, kind: "llm", traces: { stdout: "ok", stderr: "", durationMs: 900 } }),
    ];

    render(<RunPhases run={run} steps={steps} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /review/i }));

    expect(screen.getByText("prompts/review.tpl")).toBeDefined();
    // No usage on the row ⇒ no token-count section.
    expect(screen.queryByText("tokens")).toBeNull();
  });
});
