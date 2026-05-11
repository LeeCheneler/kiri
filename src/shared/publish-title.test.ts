import { describe, expect, it } from "bun:test";
import { resolvePublishTitle } from "./publish-title.ts";

describe("resolvePublishTitle", () => {
  it("returns the explicit title when provided", () => {
    expect(resolvePublishTitle("digest", "Top Stories")).toBe("Top Stories");
  });

  it("titlecases a hyphenated name when no title is set", () => {
    expect(resolvePublishTitle("hackernews-digest")).toBe("Hackernews Digest");
  });

  it("uppercases short tokens (<=2 chars) for acronyms", () => {
    expect(resolvePublishTitle("pr-digest")).toBe("PR Digest");
    expect(resolvePublishTitle("ai-news")).toBe("AI News");
  });

  it("titlecases a single-token name", () => {
    expect(resolvePublishTitle("article")).toBe("Article");
  });

  it("falls back to titlecasing when title is an empty string", () => {
    expect(resolvePublishTitle("pr-digest", "")).toBe("PR Digest");
  });
});
