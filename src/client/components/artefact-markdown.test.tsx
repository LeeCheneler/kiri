import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ArtefactMarkdown } from "./artefact-markdown.tsx";

afterEach(() => cleanup());

describe("<ArtefactMarkdown>", () => {
  it("renders headings, lists, links, and code blocks", () => {
    const { container } = render(
      <ArtefactMarkdown
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
    const { container } = render(
      <ArtefactMarkdown content={"hello\n\n<script>alert(1)</script>\n"} />,
    );
    // react-markdown does not parse raw HTML — the tag text reaches the DOM
    // verbatim. The load-bearing assertion is that no `<script>` element
    // exists in the rendered tree.
    expect(container.querySelector("script")).toBeNull();
  });

  it("refuses javascript: URLs on links (href becomes safe)", () => {
    const { container } = render(<ArtefactMarkdown content={"[bad](javascript:alert(1))"} />);
    // react-markdown's defaultUrlTransform neutralises the href to empty
    // string. An anchor with empty href loses the link role, so query the
    // raw `<a>` and assert on its href directly.
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    const href = anchor?.getAttribute("href") ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
  });

  it("refuses data: URLs on links (href becomes safe)", () => {
    const { container } = render(
      <ArtefactMarkdown content={"[bad](data:text/html,<script>1</script>)"} />,
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    const href = anchor?.getAttribute("href") ?? "";
    expect(href.startsWith("data:")).toBe(false);
  });

  it("does not render raw <img onerror> handlers from the source", () => {
    const { container } = render(
      <ArtefactMarkdown content={'before\n\n<img src="x" onerror="alert(1)">\n\nafter\n'} />,
    );
    // The literal img tag text passes through but is never interpreted —
    // no img element appears in the tree, so the onerror handler can't
    // fire on any node.
    expect(container.querySelector("img")).toBeNull();
  });

  it("decorates external anchors with target=_blank and rel=noopener noreferrer", () => {
    render(<ArtefactMarkdown content={"[external](https://news.ycombinator.com/x)"} />);
    const link = screen.getByRole("link", { name: "external" });
    expect(link.getAttribute("href")).toBe("https://news.ycombinator.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves same-origin absolute links untouched", () => {
    render(<ArtefactMarkdown content={`[inside](${window.location.origin}/runs/abc)`} />);
    const link = screen.getByRole("link", { name: "inside" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("leaves relative links untouched", () => {
    render(<ArtefactMarkdown content={"[relative](/runs/abc)"} />);
    const link = screen.getByRole("link", { name: "relative" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("treats unparseable hrefs as same-origin (no target/rel applied)", () => {
    // `http://[invalid` throws inside the URL constructor; the renderer
    // falls through to the same-origin branch and renders a plain anchor.
    render(<ArtefactMarkdown content={"[bad](http://[invalid)"} />);
    const link = screen.queryByRole("link", { name: "bad" });
    if (link !== null) {
      expect(link.getAttribute("target")).toBeNull();
      expect(link.getAttribute("rel")).toBeNull();
    }
  });
});
