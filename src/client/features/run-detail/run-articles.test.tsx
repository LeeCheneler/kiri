import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ArticleSummary } from "../../api.ts";
import { RunArticles } from "./run-articles.tsx";

const renderArticles = (articles: ArticleSummary[]) => {
  const { hook } = memoryLocation({ path: "/runs/run-1" });
  return render(
    <Router hook={hook}>
      <RunArticles runId="run-1" articles={articles} />
    </Router>,
  );
};

describe("<RunArticles>", () => {
  it("renders nothing when the run published no articles", () => {
    renderArticles([]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links each article by its first heading, falling back to its name", () => {
    renderArticles([
      { slug: "digest", name: "PR Digest", heading: "Summary", createdAt: "" },
      { slug: "notes", name: "Release Notes", heading: null, createdAt: "" },
    ]);

    // heading present → link reads the heading; absent → falls back to the name.
    const byHeading = screen.getByRole("link", { name: /summary/i });
    expect(byHeading.getAttribute("href")).toBe("/runs/run-1/articles/digest");
    const byName = screen.getByRole("link", { name: /release notes/i });
    expect(byName.getAttribute("href")).toBe("/runs/run-1/articles/notes");
  });
});
