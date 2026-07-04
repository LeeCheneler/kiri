import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ArticleReader } from "./article-reader.tsx";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const BREADCRUMB = [
  { label: "Activity", href: "/" },
  { label: "pr-review", href: "/workflows/pr-review" },
];

const renderReader = (props: Partial<Parameters<typeof ArticleReader>[0]> = {}) => {
  const { hook } = memoryLocation({ path: "/runs/abc/articles/digest" });
  return render(
    <Router hook={hook}>
      <ArticleReader
        contentMd={"# Hello\n"}
        name="PR Review Digest"
        createdAt={NOW.toISOString()}
        context="pr-review"
        breadcrumbItems={BREADCRUMB}
        now={NOW}
        {...props}
      />
    </Router>,
  );
};

describe("<ArticleReader>", () => {
  it("renders the title, breadcrumb trail, byline, and markdown body", () => {
    renderReader({
      contentMd: "# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n",
      createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
    });

    // The body's `# Hello` becomes the page title (an h1); the article name
    // rides in the eyebrow as the series label after the producer context.
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(screen.getByText("pr-review · PR Review Digest")).toBeDefined();
    // The passed trail renders as links, with the article title as current.
    expect(screen.getByRole("link", { name: /activity/i }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "pr-review" }).getAttribute("href")).toBe(
      "/workflows/pr-review",
    );
    // The byline is article-centric: when it was written, plus the body's word
    // count and reading-time estimate — of the body, with the headline lifted out.
    expect(screen.getByText(/30 seconds ago/i)).toBeDefined();
    expect(screen.getByText("4 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
    // The only byline action is copy-markdown.
    expect(screen.getByRole("button", { name: /^copy markdown$/i })).toBeDefined();
    // The headline is lifted out of the body, so the page carries exactly one
    // h1 and the headline is not also rendered as a body heading.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("copies the cleaned article — headline plus preamble-stripped body — on click", async () => {
    const writeText = mock(async (_text: string) => {});
    // userEvent.setup() stubs navigator.clipboard, so install the mock after it.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderReader({
      contentMd: "Sure, here's the article:\n\n# The Headline\n\n## Section\n\nBody copy.",
      name: "Demo",
      context: "wf",
    });

    await user.click(screen.getByRole("button", { name: /^copy markdown$/i }));

    // The lead-in chatter is gone and the headline is re-emitted as a `#` line.
    expect(writeText.mock.calls).toEqual([["# The Headline\n\n## Section\n\nBody copy."]]);
  });

  it("falls back to the article name and generic label for a heading-less body", () => {
    renderReader({ contentMd: "Body only, no heading.\n", name: "Sparse", context: "wf" });

    // With no body headline, the article name supplies the page title and the
    // eyebrow keeps the generic "Article" label.
    expect(screen.getByRole("heading", { level: 1, name: "Sparse" })).toBeDefined();
    expect(screen.getByText("wf · Article")).toBeDefined();
    expect(screen.getByText(/Body only/)).toBeDefined();
    // The byline reading stats are computed even when the body has no heading.
    expect(screen.getByText("4 words")).toBeDefined();
    expect(screen.getByText("1 min read")).toBeDefined();
  });

  it("drops the eyebrow series label when the article name restates the context", () => {
    renderReader({
      contentMd: "# Wednesday's briefing\n\n## Lead\n\nBody.\n",
      name: "Daily Briefing",
      context: "Daily Briefing",
    });

    // The article name equals the producer context, so it adds nothing — the
    // eyebrow keeps the generic "Article" label rather than echoing it.
    expect(screen.getByRole("heading", { level: 1, name: "Wednesday's briefing" })).toBeDefined();
    expect(screen.getByText("Daily Briefing · Article")).toBeDefined();
  });

  it("renders body `## section` markdown as h2 with section-NN ids and § NN eyebrows", () => {
    const { container } = renderReader({
      contentMd: "# The headline\n\n## First section\n\nBody.\n\n## Second section\n\nMore.\n",
      name: "Sectioned",
      context: "wf",
    });

    // The headline is the page h1; the `##` headings are the sections that the
    // table of contents reads, each stamped with a section-NN id and § eyebrow.
    expect(screen.getByRole("heading", { level: 1, name: "The headline" })).toBeDefined();
    const bodyH2s = Array.from(container.querySelectorAll("h2[id^='section-']"));
    expect(bodyH2s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
    expect(bodyH2s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
    expect(bodyH2s[1]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 02");
  });
});
