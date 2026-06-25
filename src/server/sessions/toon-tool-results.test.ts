import { describe, expect, it } from "bun:test";
import { decode, encode } from "@toon-format/toon";
import { type UIMessage, isToolUIPart } from "ai";
import { toonEncodeIfSmaller, toonEncodeToolResults } from "./toon-tool-results.ts";

type Part = UIMessage["parts"][number];

// A uniform array of short-field records — TOON's sweet spot, where it collapses
// to a header plus one line per record and comfortably beats the JSON.
const records = {
  results: [
    { id: 1, name: "alpha", score: 10 },
    { id: 2, name: "beta", score: 20 },
    { id: 3, name: "gamma", score: 30 },
  ],
};

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

const outputOf = (message: UIMessage | undefined, index = 0): unknown => {
  const part = message?.parts[index];
  if (!part || !isToolUIPart(part) || part.state !== "output-available")
    throw new Error("expected a tool result");
  return part.output;
};

describe("toonEncodeIfSmaller", () => {
  it("re-encodes a record array as a shorter, lossless TOON string", () => {
    const toon = toonEncodeIfSmaller(records);
    if (toon === undefined) throw new Error("expected a TOON encoding");
    expect(toon.length).toBeLessThan(JSON.stringify(records).length);
    // Lossless: decoding the emitted TOON reproduces the original JSON.
    expect(decode(toon)).toEqual(records);
  });

  it("round-trips a mixed structure of nested objects, arrays, and scalars", () => {
    // Losslessness is the library's guarantee — the size gate is irrelevant
    // here, so encode/decode directly. Pins it for the value shapes a real tool
    // result carries: nesting, nulls, numbers, and awkward strings.
    const value = {
      meta: { count: 2, ok: true, note: null },
      items: [
        { id: 1, tags: ["a", "b"], label: 'has "quotes", commas\nand newlines' },
        { id: 2, tags: [], label: "" },
      ],
    };
    expect(decode(encode(value))).toEqual(value);
  });

  it("leaves output as JSON when TOON would not be smaller", () => {
    // A scalar array encodes larger as TOON, so the JSON form is kept.
    expect(toonEncodeIfSmaller([1, 2, 3])).toBeUndefined();
    // An empty array ties on length — only a strict win is taken.
    expect(toonEncodeIfSmaller([])).toBeUndefined();
  });

  it("ignores non-object outputs", () => {
    // A string is already sent verbatim as text; a scalar gains nothing.
    expect(toonEncodeIfSmaller("already a string")).toBeUndefined();
    expect(toonEncodeIfSmaller(42)).toBeUndefined();
    expect(toonEncodeIfSmaller(null)).toBeUndefined();
  });
});

describe("toonEncodeToolResults", () => {
  it("re-encodes a settled JSON tool result as TOON when smaller", () => {
    const history = [assistant(toolResult("c1", records))];
    const out = outputOf(toonEncodeToolResults(history)[0]);
    expect(typeof out).toBe("string");
    expect(decode(out as string)).toEqual(records);
  });

  it("keeps the invocation and only rewrites the output", () => {
    const history = [assistant(toolResult("c1", records))];
    const part = toonEncodeToolResults(history)[0]?.parts[0];
    if (!part || !isToolUIPart(part) || part.state !== "output-available")
      throw new Error("expected a tool result");
    expect(part.input).toEqual({ query: "c1" });
  });

  it("leaves a result untouched when TOON would not be smaller", () => {
    const history = [assistant(toolResult("c1", [1, 2, 3]))];
    expect(outputOf(toonEncodeToolResults(history)[0])).toEqual([1, 2, 3]);
  });

  it("leaves pending, errored, non-tool, and string-output parts untouched", () => {
    const history = [
      assistant(toolPending("p1")),
      assistant(toolErrored("e1")),
      assistant(textPart("hello")),
      // A culled result's output is already a plain string — not a TOON candidate.
      assistant(toolResult("c1", "[Earlier tool result removed…]")),
    ];
    // None of these change, so each message passes through by reference.
    const out = toonEncodeToolResults(history);
    expect(out[0]).toBe(history[0]);
    expect(out[1]).toBe(history[1]);
    expect(out[2]).toBe(history[2]);
    expect(out[3]).toBe(history[3]);
  });

  it("does not mutate the input history", () => {
    const history = [assistant(toolResult("c1", records))];
    toonEncodeToolResults(history);
    expect(outputOf(history[0])).toEqual(records); // the caller's array is left intact
  });
});
