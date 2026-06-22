import { describe, expect, it } from "bun:test";
import { humaniseSlug } from "./humanise-slug.ts";

describe("humaniseSlug", () => {
  it("titlecases a hyphenated slug", () => {
    expect(humaniseSlug("financial-advisor")).toBe("Financial Advisor");
  });

  it("uppercases short tokens (<=2 chars) for acronyms", () => {
    expect(humaniseSlug("pr-digest")).toBe("PR Digest");
    expect(humaniseSlug("ai-news")).toBe("AI News");
  });

  it("titlecases a single-token slug", () => {
    expect(humaniseSlug("terse")).toBe("Terse");
  });

  it("returns an empty string unchanged", () => {
    expect(humaniseSlug("")).toBe("");
  });
});
