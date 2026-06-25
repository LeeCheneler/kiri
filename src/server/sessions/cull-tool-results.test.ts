import { describe, expect, it } from "bun:test";
import { type UIMessage, isToolUIPart } from "ai";
import {
  CULLED_RESULT_NOTICE,
  cullToolHistory,
  currentContextTokens,
} from "./cull-tool-results.ts";
import type { Message } from "./store.ts";

// A persisted row carrying only what currentContextTokens reads — its usage.
const row = (usage: Message["usage"]): Message => ({
  id: "m",
  sessionId: "s",
  index: 0,
  role: "assistant",
  parts: [],
  usage,
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

// 60% and 40% of a 1000-token window — straddling the 50% cull ratio.
const OVER_BUDGET = { contextTokens: 600, contextWindow: 1000 };
const UNDER_BUDGET = { contextTokens: 400, contextWindow: 1000 };

describe("currentContextTokens", () => {
  it("is undefined until a turn has settled with input usage", () => {
    expect(currentContextTokens([])).toBeUndefined();
    // A row whose usage omits inputTokens can't anchor a fill figure.
    expect(currentContextTokens([row(null), row({ outputTokens: 5 })])).toBeUndefined();
  });

  it("sums the most recent settled turn's input and output tokens", () => {
    const rows = [
      row({ inputTokens: 100, outputTokens: 20 }),
      row({ inputTokens: 300, outputTokens: 40 }),
    ];
    // Reads the last usage-bearing row, not the first.
    expect(currentContextTokens(rows)).toBe(340);
  });

  it("treats a missing outputTokens as zero", () => {
    expect(currentContextTokens([row({ inputTokens: 100 })])).toBe(100);
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
    // Exactly 50% is within budget — culling is for *over* half.
    expect(cullToolHistory(history, { contextTokens: 500, contextWindow: 1000 })).toBe(history);
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
