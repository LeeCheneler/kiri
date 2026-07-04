import { describe, expect, it } from "bun:test";
import { buildSummaryContext, summaryStepLabel } from "./build-summary-context.ts";

describe("summaryStepLabel", () => {
  it("prefers the authored name", () => {
    expect(summaryStepLabel({ use: "fetch-prs", id: "fetch", name: "Fetch PRs" })).toBe(
      "Fetch PRs",
    );
  });

  it("falls back to the id, then the step ident", () => {
    expect(summaryStepLabel({ use: "fetch-prs", id: "fetch" })).toBe("fetch");
    expect(summaryStepLabel({ use: "fetch-prs" })).toBe("fetch-prs");
    expect(summaryStepLabel({ llm: { model: "anthropic:m", prompt: "p" } })).toBe("anthropic:m");
  });

  it("uses the script's first non-empty line for sh steps", () => {
    expect(summaryStepLabel({ sh: "\n  set -eu\necho hi\n" })).toBe("set -eu");
    // A blank-only script has no non-empty line to promote.
    expect(summaryStepLabel({ sh: "  \n " })).toBe("  \n ");
  });
});

describe("buildSummaryContext", () => {
  it("renders the workflow header, step sections, and article sections", () => {
    const digest = buildSummaryContext({
      workflow: "Daily Briefing",
      durationMs: 12_345,
      steps: [
        { step: { sh: "curl api", id: "fetch" }, index: 0, durationMs: 900, stdout: "data\n" },
        {
          step: { llm: { model: "anthropic:m", prompt: "p" } },
          index: 1,
          durationMs: 2100,
          stdout: "",
        },
      ],
      articles: [{ slug: "digest", name: "Digest", content_md: "# Today\n\nbody" }],
    });

    expect(digest).toBe(
      [
        "Workflow: Daily Briefing",
        "Duration: 12.3s",
        "## Step 0 — fetch (900ms)\n\ndata",
        "## Step 1 — anthropic:m (2.1s)\n\n(no output)",
        "## Article: Digest (digest)\n\n# Today\n\nbody",
      ].join("\n\n"),
    );
  });

  it("omits article sections when the run produced nothing", () => {
    const digest = buildSummaryContext({
      workflow: "One Shot",
      durationMs: 100,
      steps: [{ step: { sh: "echo hi" }, index: 0, durationMs: 50, stdout: "hi\n" }],
      articles: [],
    });

    expect(digest).not.toContain("## Article:");
  });

  it("caps step stdout and article content independently at 64 KB", () => {
    const big = "x".repeat(70 * 1024);
    const digest = buildSummaryContext({
      workflow: "Chatty",
      durationMs: 100,
      steps: [{ step: { sh: "yes" }, index: 0, durationMs: 50, stdout: big }],
      articles: [{ slug: "long", name: "Long", content_md: big }],
    });

    const markers = digest.match(/\[truncated\]/g);
    expect(markers).toHaveLength(2);
    // Both capped bodies sit at the stream cap, not the raw 70 KB.
    expect(digest.length).toBeLessThan(2 * 65 * 1024);
  });
});
