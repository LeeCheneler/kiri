import { describe, expect, it } from "bun:test";
import { type RunContext, type RunContextStep, buildRunContext } from "./build-run-context.ts";

const CAP = 64 * 1024;
const MARKER = "\n[truncated]";

const makeStep = (overrides: Partial<RunContextStep> = {}): RunContextStep => ({
  kind: "sh",
  sh: "echo hi",
  index: 0,
  status: "ok",
  durationMs: 5,
  stdout: "",
  stderr: "",
  error: null,
  ...overrides,
});

const makeContext = (steps: RunContextStep[], overrides: Partial<RunContext> = {}): RunContext => ({
  workflow: "Test Workflow",
  status: "ok",
  startedAt: "2026-06-12T09:00:00.000Z",
  durationMs: 1234,
  steps,
  articles: [],
  ...overrides,
});

describe("buildRunContext", () => {
  it("serialises the run envelope shape", () => {
    const context = makeContext([makeStep({ stdout: "hello", stderr: "warn" })], {
      articles: [{ slug: "digest", name: "Digest", content_md: "# Digest" }],
    });

    const parsed = JSON.parse(buildRunContext(context));
    expect(parsed).toEqual(context);
  });

  it("pretty-prints with two-space indentation", () => {
    const context = makeContext([makeStep()]);
    expect(buildRunContext(context)).toBe(JSON.stringify(context, null, 2));
  });

  it("leaves streams at the cap untouched", () => {
    const atCap = "a".repeat(CAP);
    const parsed = JSON.parse(buildRunContext(makeContext([makeStep({ stdout: atCap })])));
    expect(parsed.steps[0].stdout).toBe(atCap);
  });

  it("truncates streams over the cap and appends the marker", () => {
    const overCap = "a".repeat(CAP + 100);
    const parsed = JSON.parse(buildRunContext(makeContext([makeStep({ stdout: overCap })])));
    expect(parsed.steps[0].stdout).toBe("a".repeat(CAP) + MARKER);
  });

  it("truncates stdout and stderr independently", () => {
    const overCap = "e".repeat(CAP + 1);
    const parsed = JSON.parse(
      buildRunContext(makeContext([makeStep({ stdout: "small", stderr: overCap })])),
    );
    expect(parsed.steps[0].stdout).toBe("small");
    expect(parsed.steps[0].stderr).toBe("e".repeat(CAP) + MARKER);
  });

  it("truncates each step's streams separately", () => {
    const overCap = "x".repeat(CAP + 1);
    const parsed = JSON.parse(
      buildRunContext(
        makeContext([makeStep({ stdout: overCap }), makeStep({ index: 1, stdout: "fine" })]),
      ),
    );
    expect(parsed.steps[0].stdout.endsWith(MARKER)).toBe(true);
    expect(parsed.steps[1].stdout).toBe("fine");
  });

  it("does not split a surrogate pair at the cap", () => {
    // The 😀 pair straddles the cap: its high surrogate is the last code
    // unit kept by the slice, so the guard must drop it.
    const stdout = `${"x".repeat(CAP - 1)}😀${"z".repeat(10)}`;
    const parsed = JSON.parse(buildRunContext(makeContext([makeStep({ stdout })])));
    expect(parsed.steps[0].stdout).toBe("x".repeat(CAP - 1) + MARKER);
    expect(parsed.steps[0].stdout.isWellFormed()).toBe(true);
  });

  it("leaves article content untouched regardless of size", () => {
    const bigArticle = "m".repeat(CAP + 100);
    const parsed = JSON.parse(
      buildRunContext(
        makeContext([makeStep()], {
          articles: [{ slug: "big", name: "Big", content_md: bigArticle }],
        }),
      ),
    );
    expect(parsed.articles[0].content_md).toBe(bigArticle);
  });

  it("does not mutate the input context", () => {
    const overCap = "a".repeat(CAP + 1);
    const step = makeStep({ stdout: overCap });
    buildRunContext(makeContext([step]));
    expect(step.stdout).toBe(overCap);
  });
});
