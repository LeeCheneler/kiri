import { describe, expect, it } from "bun:test";
import { resolvePublishName } from "./publish-name.ts";

describe("resolvePublishName", () => {
  it("returns the explicit name when provided", () => {
    expect(resolvePublishName("digest", "Top Stories")).toBe("Top Stories");
  });

  it("titlecases a hyphenated slug when no name is set", () => {
    expect(resolvePublishName("hackernews-digest")).toBe("Hackernews Digest");
  });

  it("uppercases short tokens (<=2 chars) for acronyms", () => {
    expect(resolvePublishName("pr-digest")).toBe("PR Digest");
    expect(resolvePublishName("ai-news")).toBe("AI News");
  });

  it("titlecases a single-token slug", () => {
    expect(resolvePublishName("article")).toBe("Article");
  });

  it("falls back to titlecasing when name is an empty string", () => {
    expect(resolvePublishName("pr-digest", "")).toBe("PR Digest");
  });
});
