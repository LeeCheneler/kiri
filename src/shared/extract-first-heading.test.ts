import { describe, expect, it } from "bun:test";
import { extractFirstHeading } from "./extract-first-heading.ts";

describe("extractFirstHeading", () => {
  it("returns null for empty input", () => {
    expect(extractFirstHeading("")).toBeNull();
  });

  it("returns null when no heading is present", () => {
    expect(extractFirstHeading("just a paragraph\nand another line")).toBeNull();
  });

  it("returns the text of the first h1", () => {
    expect(extractFirstHeading("# Hello world\n\nbody")).toBe("Hello world");
  });

  it("skips leading blank lines", () => {
    expect(extractFirstHeading("\n\n# Top story\n")).toBe("Top story");
  });

  it("ignores h2 and deeper", () => {
    expect(extractFirstHeading("## not me\n### me neither")).toBeNull();
  });

  it("requires a space after the hash (#tag is not a heading)", () => {
    expect(extractFirstHeading("#nope\n# yes")).toBe("yes");
  });

  it("strips trailing closing hashes", () => {
    expect(extractFirstHeading("# Heading ##")).toBe("Heading");
  });

  it("ignores headings inside a backtick-fenced code block", () => {
    const md = "```\n# not a heading\n```\n\n# real heading";
    expect(extractFirstHeading(md)).toBe("real heading");
  });

  it("ignores headings inside a tilde-fenced code block", () => {
    const md = "~~~\n# not a heading\n~~~\n\n# real heading";
    expect(extractFirstHeading(md)).toBe("real heading");
  });

  it("returns null when the only heading is inside a code fence", () => {
    expect(extractFirstHeading("```\n# fenced\n```")).toBeNull();
  });

  it("returns the first heading when multiple are present", () => {
    expect(extractFirstHeading("# first\n\n# second")).toBe("first");
  });

  it("trims surrounding whitespace from the heading text", () => {
    expect(extractFirstHeading("#    spaced out   ")).toBe("spaced out");
  });

  it("ignores leading indentation on the heading line", () => {
    expect(extractFirstHeading("   # indented")).toBe("indented");
  });
});
