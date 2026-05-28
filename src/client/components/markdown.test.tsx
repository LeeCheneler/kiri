import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { mockReactVega } from "../../../tests/setup/react-vega-mock.tsx";
import { Markdown } from "./markdown.tsx";

mockReactVega();

afterEach(() => cleanup());

describe("<Markdown>", () => {
  it("renders headings, lists, links, and code blocks", () => {
    const { container } = render(
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
    const { container } = render(<Markdown content={"hello\n\n<script>alert(1)</script>\n"} />);
    // react-markdown does not parse raw HTML — the tag text reaches the DOM
    // verbatim. The load-bearing assertion is that no `<script>` element
    // exists in the rendered tree.
    expect(container.querySelector("script")).toBeNull();
  });

  it("refuses javascript: URLs on links (href becomes safe)", () => {
    const { container } = render(<Markdown content={"[bad](javascript:alert(1))"} />);
    // react-markdown's defaultUrlTransform neutralises the href to empty
    // string. An anchor with empty href loses the link role, so query the
    // raw `<a>` and assert on its href directly.
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    const href = anchor?.getAttribute("href") ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
  });

  it("refuses data: URLs on links (href becomes safe)", () => {
    const { container } = render(<Markdown content={"[bad](data:text/html,<script>1</script>)"} />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    const href = anchor?.getAttribute("href") ?? "";
    expect(href.startsWith("data:")).toBe(false);
  });

  it("does not render raw <img onerror> handlers from the source", () => {
    const { container } = render(
      <Markdown content={'before\n\n<img src="x" onerror="alert(1)">\n\nafter\n'} />,
    );
    // The literal img tag text passes through but is never interpreted —
    // no img element appears in the tree, so the onerror handler can't
    // fire on any node.
    expect(container.querySelector("img")).toBeNull();
  });

  it("decorates external anchors with target=_blank and rel=noopener noreferrer", () => {
    render(<Markdown content={"[external](https://news.ycombinator.com/x)"} />);
    const link = screen.getByRole("link", { name: "external" });
    expect(link.getAttribute("href")).toBe("https://news.ycombinator.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves same-origin absolute links untouched", () => {
    render(<Markdown content={`[inside](${window.location.origin}/runs/abc)`} />);
    const link = screen.getByRole("link", { name: "inside" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("leaves relative links untouched", () => {
    render(<Markdown content={"[relative](/runs/abc)"} />);
    const link = screen.getByRole("link", { name: "relative" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("treats unparseable hrefs as same-origin (no target/rel applied)", () => {
    // `http://[invalid` throws inside the URL constructor; the renderer
    // falls through to the same-origin branch and renders a plain anchor.
    render(<Markdown content={"[bad](http://[invalid)"} />);
    const link = screen.queryByRole("link", { name: "bad" });
    if (link !== null) {
      expect(link.getAttribute("target")).toBeNull();
      expect(link.getAttribute("rel")).toBeNull();
    }
  });

  it("renders every supported markdown element through its styled wrapper", () => {
    // Exercises every entry in the components map so each wrapper runs at
    // least once. No styling assertions — see CLAUDE.md on not testing
    // class names; we only assert that the element type made it into the
    // DOM at all.
    const { container } = render(
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

  it("does not crash when the markdown source contains a raw <img> tag", () => {
    // react-markdown skips raw HTML, so the literal <img> doesn't reach
    // the components map — the renderer must still produce a valid tree.
    const { container } = render(<Markdown content={'<img src="x" class="custom-img" />'} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("routes a ```chart fence to the chart component", async () => {
    const { container } = render(<Markdown content={["```chart", "{}", "```"].join("\n")} />);

    // The chart chunk loads lazily — a placeholder shows first.
    expect(screen.getByText(/loading chart/i)).toBeDefined();
    // Once the lazy chunk resolves the chart figure replaces it.
    expect(await screen.findByRole("figure")).toBeDefined();
    // The chart fence is not also rendered as a code block.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("leaves non-chart fenced blocks as code blocks alongside a chart", async () => {
    const { container } = render(
      <Markdown
        content={["```chart", "{}", "```", "", "```js", "const x = 1;", "```"].join("\n")}
      />,
    );

    await screen.findByRole("figure");
    // The ```js fence still renders as an ordinary <pre><code> block.
    expect(container.querySelector("pre code")?.textContent).toMatch(/const x = 1/);
  });

  it("degrades a malformed chart spec without breaking the surrounding article", async () => {
    render(
      <Markdown
        content={[
          "Before the chart.",
          "",
          "```chart",
          "{ not json",
          "```",
          "",
          "After the chart.",
        ].join("\n")}
      />,
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    // Prose on both sides of the broken chart still renders.
    expect(screen.getByText("Before the chart.")).toBeDefined();
    expect(screen.getByText("After the chart.")).toBeDefined();
  });

  describe("withSectionOrdinals", () => {
    const source = ["# What stood out", "", "Body.", "", "# Why it matters", "", "More."].join(
      "\n",
    );

    it("stamps section-NN ids and § NN eyebrows on authored # headings", () => {
      const { container } = render(<Markdown content={source} withSectionOrdinals />);
      // No downgrade — authored # renders as h1, ordinals attach there.
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
      // Eyebrow span sits at the start of each heading and is aria-hidden
      // so the heading's accessible name remains the prose text only.
      expect(h1s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
      expect(h1s[1]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 02");
      expect(screen.getByRole("heading", { level: 1, name: "What stood out" })).toBeDefined();
      expect(screen.getByRole("heading", { level: 1, name: "Why it matters" })).toBeDefined();
    });

    it("leaves headings untouched when the prop is omitted", () => {
      const { container } = render(<Markdown content={source} />);
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s.map((h) => h.id)).toEqual(["", ""]);
      expect(h1s[0]?.querySelector("span[aria-hidden]")).toBeNull();
    });

    it("restarts the counter per Markdown instance", () => {
      // Two sibling renders must each count from 01 — the counter lives
      // inside the per-render heading component, not in module scope.
      const { container } = render(
        <>
          <Markdown content={"# Alpha"} withSectionOrdinals />
          <Markdown content={"# Beta"} withSectionOrdinals />
        </>,
      );
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s.map((h) => h.id)).toEqual(["section-01", "section-01"]);
    });

    it("does not double-count under React.StrictMode's double-render", () => {
      // Ordinals key off AST node identity rather than a plain increment,
      // so repeated invocations of the same heading return the same value
      // — guarding against StrictMode bumping § 01 to § 02 in dev.
      const { container } = render(
        <StrictMode>
          <Markdown content={"# Only Heading"} withSectionOrdinals />
        </StrictMode>,
      );
      const h1s = Array.from(container.querySelectorAll("h1"));
      expect(h1s).toHaveLength(1);
      expect(h1s[0]?.id).toBe("section-01");
      expect(h1s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
    });
  });

  describe("downgradeHeaderLevels", () => {
    it("renders authored h1 as h2 when downgrade=1", () => {
      const { container } = render(<Markdown content={"# Heading"} downgradeHeaderLevels={1} />);
      expect(container.querySelector("h2")?.textContent).toBe("Heading");
      expect(container.querySelector("h1")).toBeNull();
    });

    it("shifts every authored level by the same amount", () => {
      const { container } = render(
        <Markdown
          content={"# one\n\n## two\n\n### three\n\n#### four\n\n##### five"}
          downgradeHeaderLevels={1}
        />,
      );
      expect(container.querySelector("h2")?.textContent).toBe("one");
      expect(container.querySelector("h3")?.textContent).toBe("two");
      expect(container.querySelector("h4")?.textContent).toBe("three");
      expect(container.querySelector("h5")?.textContent).toBe("four");
      expect(container.querySelector("h6")?.textContent).toBe("five");
    });

    it("clamps at h6 so authored h6 stays h6 under any downgrade", () => {
      const { container } = render(<Markdown content={"###### Six"} downgradeHeaderLevels={2} />);
      expect(container.querySelector("h6")?.textContent).toBe("Six");
    });

    it("composes with withSectionOrdinals — eyebrows follow authored # to its rendered level", () => {
      // With downgrade=2, authored `# ` lands at h3 and picks up the
      // ordinal eyebrow. Authored `## ` shifts to h4 and stays untouched.
      const { container } = render(
        <Markdown
          content={"# First\n\n## Sub\n\n# Second"}
          downgradeHeaderLevels={2}
          withSectionOrdinals
        />,
      );
      const h3s = Array.from(container.querySelectorAll("h3"));
      expect(h3s.map((h) => h.id)).toEqual(["section-01", "section-02"]);
      expect(h3s[0]?.querySelector("span[aria-hidden]")?.textContent).toBe("§ 01");
      // No ordinal on the shifted h4 (authored ##).
      expect(container.querySelector("h4")?.querySelector("span[aria-hidden]")).toBeNull();
    });
  });
});
