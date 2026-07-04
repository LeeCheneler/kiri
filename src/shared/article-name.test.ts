import { describe, expect, it } from "bun:test";
import { resolveArticleName } from "./article-name.ts";

describe("resolveArticleName", () => {
  it("returns the explicit name when provided", () => {
    expect(resolveArticleName("digest", "Top Stories")).toBe("Top Stories");
  });

  it("titlecases a hyphenated slug when no name is set", () => {
    expect(resolveArticleName("hackernews-digest")).toBe("Hackernews Digest");
  });

  it("uppercases short tokens (<=2 chars) for acronyms", () => {
    expect(resolveArticleName("pr-digest")).toBe("PR Digest");
    expect(resolveArticleName("ai-news")).toBe("AI News");
  });

  it("titlecases a single-token slug", () => {
    expect(resolveArticleName("article")).toBe("Article");
  });

  it("falls back to titlecasing when name is an empty string", () => {
    expect(resolveArticleName("pr-digest", "")).toBe("PR Digest");
  });
});
