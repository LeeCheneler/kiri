import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ArticleSummary } from "../../api.ts";
import { ArticleList } from "./article-list.tsx";

const article = (over: Partial<ArticleSummary> = {}): ArticleSummary => ({
  slug: "digest",
  name: "Digest",
  heading: "The morning digest",
  createdAt: "2026-08-07T10:00:00.000Z",
  ...over,
});

const renderList = (articles: ArticleSummary[]) =>
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <ArticleList articles={articles} hrefFor={(a) => `/runs/r1/articles/${a.slug}`} />
    </Router>,
  );

describe("<ArticleList>", () => {
  it("renders nothing for a row that produced no articles", () => {
    const { container } = renderList([]);
    expect(container.firstChild).toBeNull();
  });

  it("links each article through the caller's href builder", () => {
    renderList([article()]);
    expect(screen.getByRole("link", { name: /The morning digest/ }).getAttribute("href")).toBe(
      "/runs/r1/articles/digest",
    );
  });

  it("falls back to the article name when the body has no heading", () => {
    renderList([article({ heading: null, name: "Headless" })]);
    expect(screen.getByRole("link", { name: /Headless/ })).toBeDefined();
  });

  it("counts the articles, singular for one", () => {
    renderList([article()]);
    expect(screen.getByText("1 article")).toBeDefined();
  });

  it("counts the articles, plural for several", () => {
    renderList([article(), article({ slug: "brief", heading: "The brief" })]);
    expect(screen.getByText("2 articles")).toBeDefined();
  });
});
