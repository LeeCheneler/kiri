import { describe, expect, it } from "bun:test";
import { extractFirstHeading, splitLeadingHeading } from "./extract-first-heading.ts";

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

  describe("inline markdown stripping", () => {
    it("strips a plain link, keeping the link text", () => {
      expect(extractFirstHeading("# [Repo - fix: thing (#42)](https://example.com/pr/42)")).toBe(
        "Repo - fix: thing (#42)",
      );
    });

    it("strips multiple links on the same heading", () => {
      expect(extractFirstHeading("# [one](https://a) and [two](https://b)")).toBe("one and two");
    });

    it("strips an image to its alt text", () => {
      expect(extractFirstHeading("# ![logo](https://example.com/logo.png) Brand")).toBe(
        "logo Brand",
      );
    });

    it("strips inline code", () => {
      expect(extractFirstHeading("# Upgrade `lodash` to v5")).toBe("Upgrade lodash to v5");
    });

    it("strips bold (asterisks and underscores)", () => {
      expect(extractFirstHeading("# **Hot** release")).toBe("Hot release");
      expect(extractFirstHeading("# __Hot__ release")).toBe("Hot release");
    });

    it("strips italic (asterisks and underscores)", () => {
      expect(extractFirstHeading("# *Hot* release")).toBe("Hot release");
      expect(extractFirstHeading("# _Hot_ release")).toBe("Hot release");
    });

    it("strips emphasis nested inside a link", () => {
      expect(extractFirstHeading("# [**bold link**](https://example.com)")).toBe("bold link");
    });

    it("strips bold-italic combined syntax", () => {
      expect(extractFirstHeading("# ***intense*** release")).toBe("intense release");
    });

    it("leaves plain text untouched", () => {
      expect(extractFirstHeading("# Just plain text, no syntax")).toBe(
        "Just plain text, no syntax",
      );
    });
  });
});

describe("splitLeadingHeading", () => {
  it("returns a null heading and the input unchanged when there is no h1", () => {
    expect(splitLeadingHeading("## section\n\nbody copy")).toEqual({
      heading: null,
      body: "## section\n\nbody copy",
    });
  });

  it("returns an empty body for empty input", () => {
    expect(splitLeadingHeading("")).toEqual({ heading: null, body: "" });
  });

  it("splits the headline from the body", () => {
    expect(splitLeadingHeading("# Headline\n\n## A section\n\nbody")).toEqual({
      heading: "Headline",
      body: "## A section\n\nbody",
    });
  });

  it("drops assistant preamble before the headline", () => {
    const md = "Sure, here's the piece you asked for:\n\n# Headline\n\nbody";
    expect(splitLeadingHeading(md)).toEqual({ heading: "Headline", body: "body" });
  });

  it("trims blank lines between the headline and the body", () => {
    expect(splitLeadingHeading("# Headline\n\n\n\nbody")).toEqual({
      heading: "Headline",
      body: "body",
    });
  });

  it("yields an empty body when the headline is the only content", () => {
    expect(splitLeadingHeading("# Headline")).toEqual({ heading: "Headline", body: "" });
  });

  it("removes only the first h1, leaving later ones in the body", () => {
    expect(splitLeadingHeading("# First\n\nintro\n\n# Second\n\nmore")).toEqual({
      heading: "First",
      body: "intro\n\n# Second\n\nmore",
    });
  });

  it("ignores a headline inside a fenced code block", () => {
    const md = "```\n# fenced\n```\n\n# Real headline\n\nbody";
    expect(splitLeadingHeading(md)).toEqual({ heading: "Real headline", body: "body" });
  });

  it("strips inline markdown from the headline but leaves the body intact", () => {
    expect(splitLeadingHeading("# **Bold** headline\n\nstays **bold** here")).toEqual({
      heading: "Bold headline",
      body: "stays **bold** here",
    });
  });
});
