import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { mockReactVega } from "../../../../tests/setup/react-vega-mock.tsx";
import { Markdown } from "./markdown.tsx";

mockReactVega();

// Internal links render through wouter's <Link>, so every render needs a
// router in context.
const renderMd = (node: ReactNode) => {
  const { hook } = memoryLocation({ path: "/" });
  return render(<Router hook={hook}>{node}</Router>);
};

describe("<Markdown>", () => {
  it("renders headings, lists, links, and code blocks", () => {
    const { container } = renderMd(
      <Markdown
        content={[
          "# Heading",
          "",
          "Body paragraph with `inline code`.",
          "",
          "- one",
          "- two",
          "",
          "[example](https://example.com)",
          "",
          "```",
          "block code",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeDefined();
    expect(container.querySelector("code")?.textContent).toBe("inline code");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["one", "two"]);
    expect(screen.getByRole("link", { name: "example" }).getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(container.querySelector("pre code")?.textContent).toMatch(/block code/);
  });

  it("renders raw <script> tags from source as plain text, never as elements", () => {
    const { container } = renderMd(<Markdown content={"hello\n\n<script>alert(1)</script>\n"} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("refuses javascript: URLs on links (href becomes safe)", () => {
    const { container } = renderMd(<Markdown content={"[bad](javascript:alert(1))"} />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    const href = anchor?.getAttribute("href") ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
  });

  it("decorates external anchors with target, rel, and a trailing arrow", () => {
    renderMd(<Markdown content={"[external](https://news.ycombinator.com/x)"} />);
    const link = screen.getByRole("link", { name: "external" });
    expect(link.getAttribute("href")).toBe("https://news.ycombinator.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(link.textContent).toContain("↗");
  });

  it("renders same-origin links without target or rel", () => {
    renderMd(<Markdown content={"[relative](/runs/abc)"} />);
    const link = screen.getByRole("link", { name: "relative" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
    expect(link.textContent).not.toContain("↗");
  });

  it("renders a fragment link as a same-page anchor", () => {
    renderMd(<Markdown content={"[jump](#section-01)"} />);
    const link = screen.getByRole("link", { name: "jump" });
    expect(link.getAttribute("href")).toBe("#section-01");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("treats unparseable hrefs as same-origin", () => {
    renderMd(<Markdown content={"[bad](http://[invalid)"} />);
    const link = screen.queryByRole("link", { name: "bad" });
    if (link !== null) {
      expect(link.getAttribute("target")).toBeNull();
    }
  });

  it("renders every supported markdown element", () => {
    const { container } = renderMd(
      <Markdown
        content={[
          "# H1",
          "## H2",
          "### H3",
          "#### H4",
          "##### H5",
          "###### H6",
          "",
          "Para with **strong**, *em*, and ~~del~~ text.",
          "",
          "> quoted",
          "",
          "- ul item",
          "",
          "1. ol item",
          "",
          "---",
          "",
          "Inline `code` here.",
          "",
          "```",
          "fenced",
          "```",
          "",
          "![alt](https://example.com/i.png)",
          "",
          "| a | b |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n")}
      />,
    );
    for (const tag of [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "strong",
      "em",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "hr",
      "code",
      "pre",
      "img",
      "table",
      "th",
      "td",
    ]) {
      expect(container.querySelector(tag)).not.toBeNull();
    }
  });

  it("routes a ```chart fence to the chart component", async () => {
    const { container } = renderMd(<Markdown content={["```chart", "{}", "```"].join("\n")} />);
    expect(await screen.findByRole("figure")).toBeDefined();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("leaves non-chart fenced blocks as code blocks alongside a chart", async () => {
    const { container } = renderMd(
      <Markdown
        content={["```chart", "{}", "```", "", "```js", "const x = 1;", "```"].join("\n")}
      />,
    );
    await screen.findByRole("figure");
    expect(container.querySelector("pre code")?.textContent).toMatch(/const x = 1/);
  });

  it("degrades a malformed chart spec without breaking the surrounding document", async () => {
    renderMd(
      <Markdown
        content={["Before.", "", "```chart", "{ not json", "```", "", "After."].join("\n")}
      />,
    );
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Before.")).toBeDefined();
    expect(screen.getByText("After.")).toBeDefined();
  });

  describe("withSectionOrdinals", () => {
    const source = ["# What stood out", "", "Body.", "", "# Why it matters", "", "More."].join(
      "\n",
    );

    it("stamps section-NN ids and § NN eyebrows on authored # headings", () => {
      const { container } = renderMd(<Markdown content={source} withSectionOrdinals />);
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
      expect(h1s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
      expect(h1s[1]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 02");
      expect(screen.getByRole("heading", { level: 1, name: "What stood out" })).toBeDefined();
    });

    it("leaves headings untouched when the prop is omitted", () => {
      const { container } = renderMd(<Markdown content={source} />);
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s.map((h) => h.id)).toEqual(["", ""]);
      expect(h1s[0]?.querySelector("span[aria-hidden]")).toBeNull();
    });

    it("does not double-count under React.StrictMode's double-render", () => {
      const { container } = renderMd(
        <StrictMode>
          <Markdown content={"# Only Heading"} withSectionOrdinals />
        </StrictMode>,
      );
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s).toHaveLength(1);
      expect(h1s[0]?.id).toBe("section-01");
    });

    it("attaches the ordinals to the authored level named by sectionLevel", () => {
      const { container } = renderMd(
        <Markdown
          content={"# Headline\n\n## First\n\nBody.\n\n## Second\n\nMore."}
          withSectionOrdinals
          sectionLevel={2}
        />,
      );
      const h2s = Array.from(container.querySelectorAll("h2"));
      expect(h2s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
      expect(h2s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
      // The authored `#` headline is left un-sectioned.
      expect(container.querySelector("h1")?.id).toBe("");
      expect(container.querySelector("h1")?.querySelector("span[aria-hidden]")).toBeNull();
    });
  });

  describe("downgradeHeaderLevels", () => {
    it("shifts every authored level by the same amount, clamped at h6", () => {
      const { container } = renderMd(
        <Markdown
          content={"# one\n\n## two\n\n### three\n\n#### four\n\n##### five\n\n###### six"}
          downgradeHeaderLevels={1}
        />,
      );
      expect(container.querySelector("h2")?.textContent).toBe("one");
      expect(container.querySelector("h3")?.textContent).toBe("two");
      expect(container.querySelector("h1")).toBeNull();
      const h6s = Array.from(container.querySelectorAll("h6")).map((h) => h.textContent);
      expect(h6s).toContain("five");
      expect(h6s).toContain("six");
    });

    it("composes with withSectionOrdinals — eyebrows follow authored # to its rendered level", () => {
      const { container } = renderMd(
        <Markdown
          content={"# First\n\n## Sub\n\n# Second"}
          downgradeHeaderLevels={2}
          withSectionOrdinals
        />,
      );
      const h3s = Array.from(container.querySelectorAll("h3"));
      expect(h3s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
      expect(container.querySelector("h4")?.querySelector("span[aria-hidden]")).toBeNull();
    });
  });
});
