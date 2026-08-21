import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ArticleFeedEntry, ArticleProducer } from "../../api.ts";
import { ArticleRow } from "./article-row.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const entry = (producer: ArticleProducer, over: Partial<ArticleFeedEntry> = {}) =>
  ({
    slug: "digest",
    name: "Digest",
    heading: "The morning digest",
    createdAt: "2026-08-07T10:00:00.000Z",
    producer,
    ...over,
  }) satisfies ArticleFeedEntry;

const renderRow = (article: ArticleFeedEntry, context?: "feed" | "scoped") =>
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <ArticleRow article={article} now={NOW} context={context} />
    </Router>,
  );

const hrefOf = (name: RegExp | string) => screen.getByRole("link", { name }).getAttribute("href");

describe("<ArticleRow>", () => {
  it("routes a run's article under its run", () => {
    renderRow(entry({ kind: "run", id: "r1", label: "Morning briefing" }));
    expect(hrefOf(/The morning digest/)).toBe("/runs/r1/articles/digest");
    expect(hrefOf("Morning briefing")).toBe("/runs/r1");
  });

  it("routes a session's article under its session", () => {
    renderRow(entry({ kind: "session", id: "s1", label: "Corpus sweep" }));
    expect(hrefOf(/The morning digest/)).toBe("/sessions/s1/articles/digest");
    expect(hrefOf("Corpus sweep")).toBe("/sessions/s1");
  });

  it("routes a project's article under its project", () => {
    renderRow(entry({ kind: "project", id: "p1", label: "Research" }));
    expect(hrefOf(/The morning digest/)).toBe("/projects/p1/articles/digest");
    expect(hrefOf("Research")).toBe("/projects/p1");
  });

  it("falls back to the article name when the body has no heading", () => {
    renderRow(entry({ kind: "run", id: "r1", label: "wf" }, { heading: null, name: "Headless" }));
    expect(screen.getByRole("link", { name: /Headless/ })).toBeDefined();
  });

  it("drops the kind marker and container link when scoped to its container", () => {
    renderRow(entry({ kind: "project", id: "p1", label: "Research" }), "scoped");
    expect(screen.queryByText("article")).toBeNull();
    expect(screen.queryByRole("link", { name: "Research" })).toBeNull();
    // The age and the heading link keep the feed's anatomy.
    expect(screen.getByText("2 hours ago")).toBeDefined();
    expect(hrefOf(/The morning digest/)).toBe("/projects/p1/articles/digest");
  });
});
