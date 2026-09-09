import { describe, expect, it } from "bun:test";
import type { DataUIPart, UIDataTypes } from "ai";
import { compactionStatusOf } from "./compaction-status.ts";

const part = (overrides: Record<string, unknown>): DataUIPart<UIDataTypes> =>
  ({
    type: "data-compaction",
    data: { status: "started" },
    ...overrides,
  }) as DataUIPart<UIDataTypes>;

describe("compactionStatusOf", () => {
  it("reads started and finished compaction updates", () => {
    expect(compactionStatusOf(part({}))).toBe(true);
    expect(compactionStatusOf(part({ data: { status: "finished" } }))).toBe(false);
  });

  it("ignores unrelated and malformed data parts", () => {
    expect(compactionStatusOf(part({ type: "data-something-else" }))).toBeNull();
    expect(compactionStatusOf(part({ data: { status: "waiting" } }))).toBeNull();
    expect(compactionStatusOf(part({ data: null }))).toBeNull();
  });
});
