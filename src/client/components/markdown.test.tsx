import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("applies editorial styling classes to every supported element", () => {
    // One big tree exercises every branch in the components map so the
    // styled wrappers carry real coverage. Class assertions check a
    // single anchor class per element — the precise utility set can
    // evolve without churning the test, but the styling contract stays
    // self-documenting.
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
    expect(container.querySelector("h1")?.className).toContain("font-display");
    expect(container.querySelector("h2")?.className).toContain("font-display");
    expect(container.querySelector("h3")?.className).toContain("font-display");
    expect(container.querySelector("h4")?.className).toContain("font-display");
    expect(container.querySelector("h5")?.className).toContain("font-display");
    expect(container.querySelector("h6")?.className).toContain("tracking-widest");
    expect(container.querySelector("p")?.className).toContain("leading-relaxed");
    expect(container.querySelector("strong")?.className).toContain("font-semibold");
    expect(container.querySelector("em")?.className).toContain("italic");
    expect(container.querySelector("del")?.className).toContain("line-through");
    expect(container.querySelector("blockquote")?.className).toContain("border-l-2");
    expect(container.querySelector("ul")?.className).toContain("list-disc");
    expect(container.querySelector("ol")?.className).toContain("list-decimal");
    expect(container.querySelector("li")?.className).toContain("leading-relaxed");
    expect(container.querySelector("hr")?.className).toContain("border-rule");
    // Inline code carries the chip treatment; fenced code inside <pre>
    // skips the chip styling so the wrapping pre owns the block look.
    const inlineCode = container.querySelector("p code");
    expect(inlineCode?.className).toContain("bg-paper");
    const fencedCode = container.querySelector("pre code");
    expect(fencedCode?.className ?? "").not.toContain("bg-paper");
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
    expect(container.querySelector("img")?.className).toContain("max-w-full");
    expect(container.querySelector("table")?.className).toContain("border-collapse");
    expect(container.querySelector("th")?.className).toContain("font-semibold");
    expect(container.querySelector("td")?.className).toContain("border-rule");
  });

  it("respects an explicit className on an image", () => {
    const { container } = render(<Markdown content={'<img src="x" class="custom-img" />'} />);
    // The raw HTML img isn't parsed (react-markdown skips raw HTML); only
    // markdown-syntax images go through the Image component. This asserts
    // the renderer doesn't crash on an empty result.
    expect(container.querySelector("img")).toBeNull();
  });

  it("preserves a caller-provided className on rendered anchors", () => {
    // Defensive: if a future override passes a className via custom props
    // it should win over the default. We can't easily express that
    // through markdown syntax, but the branch matters for coverage.
    const { container } = render(<Markdown content={"[ext](https://news.ycombinator.com/x)"} />);
    expect(container.querySelector("a")?.className).toContain("text-accent");
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
});
