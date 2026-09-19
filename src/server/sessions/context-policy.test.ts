import { describe, expect, it } from "bun:test";
import {
  type StepContext,
  contextLimits,
  decideHandoff,
  decideStep,
  decideSummary,
} from "./context-policy.ts";

// A 200K window: 8,192 output, 4,096 tool-result room.
const limits = contextLimits(200000);

const step = (overrides: Partial<StepContext> = {}): StepContext => ({
  limits,
  requestTokens: 1000,
  fixedTokens: 500,
  stepNumber: 1,
  incomingMessageCount: 0,
  previousMessageCount: 0,
  messageCount: 6,
  compacted: false,
  ...overrides,
});

describe("contextLimits", () => {
  it("derives the compaction threshold and summary allowance from the work allowance", () => {
    expect(limits).toEqual({
      workInputTokens: 187712,
      handoffInputTokens: 191808,
      compactionThreshold: 159555,
      summaryBudget: 4096,
    });
    // A small window asks for a fifth of its work allowance rather than the cap.
    expect(contextLimits(16000)).toMatchObject({ workInputTokens: 11200, summaryBudget: 2240 });
  });

  it("falls back to a 32K window when the model's window is unknown", () => {
    expect(contextLimits(undefined)).toEqual(contextLimits(32768));
  });

  it("reserves an explicit thinking budget in full", () => {
    const thinking = (value: unknown) =>
      contextLimits(200000, { anthropic: { thinking: value as never } });
    expect(thinking({ type: "enabled", budgetTokens: 32000 }).handoffInputTokens).toBe(
      200000 - 33024,
    );
    // Anything short of a numeric budget reserves nothing extra.
    for (const value of [undefined, "adaptive", [32000], { type: "enabled" }])
      expect(thinking(value)).toEqual(limits);
    expect(contextLimits(200000, { openai: { reasoningEffort: "high" } })).toEqual(limits);
  });
});

describe("decideStep", () => {
  const threshold = limits.compactionThreshold;

  it("continues below the compaction threshold and compacts on reaching it", () => {
    expect(decideStep(step({ requestTokens: threshold - 1 }))).toEqual({ action: "continue" });
    expect(decideStep(step({ requestTokens: threshold }))).toEqual({
      action: "compact",
      summarise: 6,
      carryIncoming: false,
    });
  });

  it("summarises only the history before the incoming messages ahead of any work", () => {
    const opening = step({
      requestTokens: threshold,
      stepNumber: 0,
      incomingMessageCount: 1,
      previousMessageCount: 4,
    });
    expect(decideStep(opening)).toEqual({ action: "compact", summarise: 4, carryIncoming: true });
    // Once work has begun, the request and its completed steps are summarised too.
    expect(decideStep({ ...opening, stepNumber: 1 })).toEqual({
      action: "compact",
      summarise: 6,
      carryIncoming: false,
    });
    // A continuation has no incoming messages to hold back.
    expect(decideStep({ ...opening, incomingMessageCount: 0 })).toEqual({
      action: "compact",
      summarise: 6,
      carryIncoming: false,
    });
  });

  it("does not summarise an oversized opening request with no earlier history", () => {
    const opening = step({ stepNumber: 0, incomingMessageCount: 1, previousMessageCount: 0 });
    expect(decideStep({ ...opening, requestTokens: threshold })).toEqual({ action: "continue" });
    expect(decideStep({ ...opening, requestTokens: limits.workInputTokens + 1 })).toEqual({
      action: "stop",
    });
  });

  it("keeps working when the fixed context alone reaches the threshold but the request fits", () => {
    const fixed = step({ requestTokens: threshold + 10, fixedTokens: threshold });
    expect(decideStep(fixed)).toEqual({ action: "continue" });
    expect(decideStep({ ...fixed, fixedTokens: threshold - 1 }).action).toBe("compact");
  });

  it("compacts at most once per boundary, then runs only while the request fits", () => {
    const compacted = step({ compacted: true });
    expect(decideStep({ ...compacted, requestTokens: limits.workInputTokens })).toEqual({
      action: "continue",
    });
    expect(decideStep({ ...compacted, requestTokens: limits.workInputTokens + 1 })).toEqual({
      action: "stop",
    });
  });
});

describe("decideSummary", () => {
  const summary = { limits, produced: true, summaryEstimate: 2000, previousEstimate: 170000 };

  it("resumes on a summary that shrinks the request below the threshold", () => {
    expect(decideSummary(summary)).toBe("resume");
    expect(decideSummary({ ...summary, summaryEstimate: limits.compactionThreshold - 1 })).toBe(
      "resume",
    );
  });

  it("stops when no summary was produced", () => {
    expect(decideSummary({ ...summary, produced: false })).toBe("stop");
  });

  it("stops on a summary that leaves the request at the threshold", () => {
    expect(decideSummary({ ...summary, summaryEstimate: limits.compactionThreshold })).toBe("stop");
  });

  it("stops on a summary no smaller than what it replaces", () => {
    expect(decideSummary({ ...summary, summaryEstimate: 2000, previousEstimate: 2000 })).toBe(
      "stop",
    );
  });
});

describe("decideHandoff", () => {
  it("spends the handoff call only when it fits the reclaimed allowance", () => {
    expect(decideHandoff({ limits, handoffTokens: limits.handoffInputTokens })).toBe("handoff");
    expect(decideHandoff({ limits, handoffTokens: limits.handoffInputTokens + 1 })).toBe("stop");
    // The handoff has room a work step does not.
    expect(decideHandoff({ limits, handoffTokens: limits.workInputTokens + 1 })).toBe("handoff");
  });
});
