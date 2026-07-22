import { describe, expect, it } from "bun:test";
import { stepLabel } from "./step-label.ts";

describe("stepLabel", () => {
  it("prefers the authored name over every fallback", () => {
    expect(stepLabel({ use: "fetch-prs", id: "fetch", name: "Fetch PRs" })).toBe("Fetch PRs");
  });

  it("falls back to id, then the step's ident", () => {
    expect(stepLabel({ use: "fetch-prs", id: "fetch" })).toBe("fetch");
    expect(stepLabel({ use: "fetch-prs" })).toBe("fetch-prs");
    expect(stepLabel({ llm: { model: "anthropic:m", prompt: "p" } })).toBe("anthropic:m");
  });

  it("labels an sh step by its first non-empty line, trimmed", () => {
    expect(stepLabel({ sh: "\n  set -eu\necho hi\n" })).toBe("set -eu");
  });

  it("falls back to the raw script when every line is blank", () => {
    expect(stepLabel({ sh: "  \n " })).toBe("  \n ");
  });
});
