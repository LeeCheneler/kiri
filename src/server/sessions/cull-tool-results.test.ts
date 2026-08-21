import { describe, expect, it } from "bun:test";
import { type UIMessage, isToolUIPart } from "ai";
import {
  CULLED_RESULT_NOTICE,
  cullToolHistory,
  currentContextTokens,
} from "./cull-tool-results.ts";
import type { Message } from "./store.ts";

// A persisted row carrying only what currentContextTokens reads — its footprint.
const row = (contextTokens: number | null): Message => ({
  id: "m",
  sessionId: "s",
  index: 0,
  role: "assistant",
  parts: [],
  contextTokens,
  createdAt: new Date(),
});

type Part = UIMessage["parts"][number];

const toolResult = (id: string, output: unknown): Part =>
  ({
    type: "tool-search",
    toolCallId: id,
    state: "output-available",
    input: { query: id },
    output,
  }) as Part;
const toolPending = (id: string): Part =>
  ({ type: "tool-search", toolCallId: id, state: "input-available", input: { query: id } }) as Part;
const toolErrored = (id: string): Part =>
  ({
    type: "tool-search",
    toolCallId: id,
    state: "output-error",
    input: { query: id },
    errorText: "boom",
  }) as Part;
const textPart = (text: string): Part => ({ type: "text", text });
const delegateResult = (id: string, output: unknown): Part =>
  ({
    type: "tool-delegate",
    toolCallId: id,
    state: "output-available",
    input: { task: id },
    output,
  }) as Part;

const assistant = (...parts: Part[]): UIMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  parts,
});

// Every output-available tool result's output, flattened across the history in order.
const toolOutputs = (history: UIMessage[]): unknown[] => {
  const outputs: unknown[] = [];
  for (const message of history) {
    for (const part of message.parts) {
      if (isToolUIPart(part) && part.state === "output-available") outputs.push(part.output);
    }
  }
  return outputs;
};

// 90% and 70% of a 1000-token window — straddling the 80% cull ratio.
const OVER_BUDGET = { contextTokens: 900, contextWindow: 1000 };
const UNDER_BUDGET = { contextTokens: 700, contextWindow: 1000 };

describe("currentContextTokens", () => {
  it("is undefined until a turn has settled with a recorded footprint", () => {
    expect(currentContextTokens([])).toBeUndefined();
    // Rows with no recorded footprint can't anchor a figure.
    expect(currentContextTokens([row(null), row(null)])).toBeUndefined();
  });

  it("reads the most recent footprint-bearing row's context footprint", () => {
    // Reads the last footprint, not the first.
    expect(currentContextTokens([row(120), row(340)])).toBe(340);
  });
});

describe("cullToolHistory", () => {
  it("returns the history unchanged when the context window is unknown", () => {
    const history = [assistant(toolResult("c1", { big: "x" }))];
    expect(cullToolHistory(history, { contextTokens: 600, contextWindow: undefined })).toBe(
      history,
    );
  });

  it("returns the history unchanged when the fill is unknown", () => {
    const history = [assistant(toolResult("c1", { big: "x" }))];
    expect(cullToolHistory(history, { contextTokens: undefined, contextWindow: 1000 })).toBe(
      history,
    );
  });

  it("returns the history unchanged at or below the cull ratio", () => {
    const history = [
      assistant(
        toolResult("c1", { a: 1 }),
        toolResult("c2", { b: 2 }),
        toolResult("c3", { c: 3 }),
        toolResult("c4", { d: 4 }),
      ),
    ];
    expect(cullToolHistory(history, UNDER_BUDGET)).toBe(history);
    // Exactly at the ratio is within budget — culling is for *over* it.
    expect(cullToolHistory(history, { contextTokens: 800, contextWindow: 1000 })).toBe(history);
  });

  it("returns the history unchanged when there are no more results than we keep", () => {
    const history = [
      assistant(toolResult("c1", { a: 1 }), toolResult("c2", { b: 2 }), toolResult("c3", { c: 3 })),
    ];
    expect(cullToolHistory(history, OVER_BUDGET)).toBe(history);
  });

  it("culls all but the most recent three tool results when over budget", () => {
    const history = [
      assistant(toolResult("c1", { a: 1 }), textPart("step one")),
      assistant(toolResult("c2", { b: 2 }), toolResult("c3", { c: 3 })),
      assistant(toolResult("c4", { d: 4 }), toolResult("c5", { e: 5 }), textPart("done")),
    ];

    // Five results across three messages: the oldest two give way to the notice,
    // the most recent three keep their full output.
    expect(toolOutputs(cullToolHistory(history, OVER_BUDGET))).toEqual([
      CULLED_RESULT_NOTICE,
      CULLED_RESULT_NOTICE,
      { c: 3 },
      { d: 4 },
      { e: 5 },
    ]);
  });

  it("keeps a culled call's invocation, only replacing its result", () => {
    const history = [
      assistant(toolResult("c1", { a: 1 })),
      assistant(toolResult("c2", { b: 2 }), toolResult("c3", { c: 3 }), toolResult("c4", { d: 4 })),
    ];

    const culled = cullToolHistory(history, OVER_BUDGET);
    const part = culled[0]?.parts[0];
    if (!part || !isToolUIPart(part) || part.state !== "output-available")
      throw new Error("expected a tool result");
    expect(part.input).toEqual({ query: "c1" }); // invocation intact
    expect(part.output).toBe(CULLED_RESULT_NOTICE); // result replaced
  });

  it("leaves pending and errored tool calls untouched and uncounted", () => {
    const history = [
      assistant(toolPending("p1")),
      assistant(toolErrored("e1")),
      assistant(
        toolResult("c1", { a: 1 }),
        toolResult("c2", { b: 2 }),
        toolResult("c3", { c: 3 }),
        toolResult("c4", { d: 4 }),
      ),
    ];

    const culled = cullToolHistory(history, OVER_BUDGET);
    // Only settled results count toward the three we keep: c1 is culled, the
    // pending and errored calls are left exactly as they were.
    expect(culled[0]).toBe(history[0]);
    expect(culled[1]).toBe(history[1]);
    expect(toolOutputs(culled)).toEqual([CULLED_RESULT_NOTICE, { b: 2 }, { c: 3 }, { d: 4 }]);
  });

  it("culls a delegate result like any other — reports ride the transcript now", () => {
    // Since async delegation, a worker's report is an ordinary inbox message
    // in the transcript; the delegate call's own result is just the spawn
    // acknowledgement, so it earns no exemption.
    const history = [
      assistant(delegateResult("d1", "spawn acknowledgement")),
      assistant(toolResult("c1", { a: 1 })),
      assistant(toolResult("c2", { b: 2 }), toolResult("c3", { c: 3 })),
    ];

    const culled = cullToolHistory(history, OVER_BUDGET);
    expect(toolOutputs(culled)).toEqual([CULLED_RESULT_NOTICE, { a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("does not mutate the input history", () => {
    const history = [
      assistant(toolResult("c1", { a: 1 })),
      assistant(toolResult("c2", { b: 2 }), toolResult("c3", { c: 3 }), toolResult("c4", { d: 4 })),
    ];

    cullToolHistory(history, OVER_BUDGET);
    const original = history[0]?.parts[0];
    if (!original || !isToolUIPart(original) || original.state !== "output-available")
      throw new Error("expected a tool result");
    expect(original.output).toEqual({ a: 1 }); // the caller's array is left intact
  });
});
