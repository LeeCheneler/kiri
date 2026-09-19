import { describe, expect, it } from "bun:test";
import { INDEX_TEXT_LIMIT, asPromptIndex, indexText, promptIndex } from "./prompt-index.ts";

describe("prompt index", () => {
  it("counts whatever exists beyond the listed entries as omitted", () => {
    expect(promptIndex(["a", "b"], 5)).toEqual({ entries: ["a", "b"], omitted: 3 });
    expect(promptIndex(["a", "b"], 2).omitted).toBe(0);
    // An entry deleted between the listing and the count never reads as negative.
    expect(promptIndex(["a", "b"], 1).omitted).toBe(0);
  });

  it("reads a plain list as an index that omits nothing", () => {
    expect(asPromptIndex(["a"])).toEqual({ entries: ["a"], omitted: 0 });

    const index = promptIndex(["a"], 4);
    expect(asPromptIndex(index)).toBe(index);
  });

  it("keeps an entry's text to one line and cuts it past the limit", () => {
    expect(indexText("Deploys land\n  on Tuesdays. ")).toBe("Deploys land on Tuesdays.");

    const cut = indexText("x".repeat(INDEX_TEXT_LIMIT + 40));
    expect(cut).toBe(`${"x".repeat(INDEX_TEXT_LIMIT)}…`);
    expect(indexText("x".repeat(INDEX_TEXT_LIMIT))).toBe("x".repeat(INDEX_TEXT_LIMIT));
  });
});
