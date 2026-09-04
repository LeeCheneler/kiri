import { describe, expect, it } from "bun:test";
import { normaliseLatexFallbacks } from "./latex-fallbacks.ts";

describe("normaliseLatexFallbacks", () => {
  it("rewrites inline \\(…\\) to $…$", () => {
    expect(normaliseLatexFallbacks("Inline \\(E=mc^2\\) here")).toBe("Inline $E=mc^2$ here");
  });

  it("rewrites display \\[…\\] to $$…$$", () => {
    expect(normaliseLatexFallbacks("Block \\[a+b\\] here")).toBe("Block $$a+b$$ here");
  });

  it("rewrites display maths spanning multiple lines", () => {
    expect(normaliseLatexFallbacks("\\[\n\\frac{1}{2}\n\\]")).toBe("$$\n\\frac{1}{2}\n$$");
  });

  it("rewrites several delimiters in one string", () => {
    expect(normaliseLatexFallbacks("\\(a\\) then \\(b\\)")).toBe("$a$ then $b$");
  });

  it("leaves delimiters inside inline code untouched", () => {
    expect(normaliseLatexFallbacks("Code `\\(x\\)` here")).toBe("Code `\\(x\\)` here");
  });

  it("leaves delimiters inside a fenced block untouched", () => {
    const src = "```\n\\(x\\)\n```";
    expect(normaliseLatexFallbacks(src)).toBe(src);
  });

  it("leaves existing $ maths untouched", () => {
    expect(normaliseLatexFallbacks("Inline $x$ and $$y$$")).toBe("Inline $x$ and $$y$$");
  });

  it("leaves an unterminated delimiter untouched", () => {
    expect(normaliseLatexFallbacks("text \\( not closed")).toBe("text \\( not closed");
  });

  it("unwraps a bare \\boxed{…} to bold", () => {
    expect(normaliseLatexFallbacks("Answer: \\boxed{42}")).toBe("Answer: **42**");
  });

  it("unwraps \\text{…} to plain text", () => {
    expect(normaliseLatexFallbacks("\\text{hello there}")).toBe("hello there");
  });

  it("unwraps \\textit{…} to italic", () => {
    expect(normaliseLatexFallbacks("\\textit{note}")).toBe("*note*");
  });

  it("leaves commands not on the allowlist untouched", () => {
    // \frac is multi-argument; stripping its braces would corrupt it.
    expect(normaliseLatexFallbacks("\\frac{1}{2}")).toBe("\\frac{1}{2}");
  });

  it("leaves a command inside inline code untouched", () => {
    expect(normaliseLatexFallbacks("`\\boxed{x}`")).toBe("`\\boxed{x}`");
  });

  describe("currency dollars", () => {
    it("escapes lone currency dollars so they never pair into maths", () => {
      expect(normaliseLatexFallbacks("costs $400m, was $150 and up to $500 each")).toBe(
        "costs \\$400m, was \\$150 and up to \\$500 each",
      );
    });

    it("escapes a currency pair joined by punctuation", () => {
      expect(normaliseLatexFallbacks("$5-$10 or ($80m)")).toBe("\\$5-\\$10 or (\\$80m)");
    });

    it("keeps inline maths, including maths starting with a digit", () => {
      expect(normaliseLatexFallbacks("$x$ and $2\\pi r$ and $1 + 1 = 2$")).toBe(
        "$x$ and $2\\pi r$ and $1 + 1 = 2$",
      );
    });

    it("escapes currency that shares a paragraph with real maths", () => {
      expect(normaliseLatexFallbacks("costs $400m; the formula $E=mc^2$")).toBe(
        "costs \\$400m; the formula $E=mc^2$",
      );
    });

    it("escapes a dollar followed by a space", () => {
      expect(normaliseLatexFallbacks("$ 5 and 5 $")).toBe("\\$ 5 and 5 \\$");
    });

    it("does not pair across a blank line", () => {
      expect(normaliseLatexFallbacks("$5\n\nx$")).toBe("\\$5\n\nx\\$");
    });

    it("leaves display maths and $$ untouched", () => {
      expect(normaliseLatexFallbacks("$$\na+b\n$$ and $$x$$")).toBe("$$\na+b\n$$ and $$x$$");
    });

    it("does not pair a lone dollar with a $$", () => {
      expect(normaliseLatexFallbacks("$5 then $$x$$")).toBe("\\$5 then $$x$$");
    });

    it("leaves an already-escaped dollar alone", () => {
      expect(normaliseLatexFallbacks("\\$5 and \\\\ and $x$")).toBe("\\$5 and \\\\ and $x$");
    });

    it("leaves dollars inside code untouched", () => {
      expect(normaliseLatexFallbacks("`$5` and ```\n$5\n```")).toBe("`$5` and ```\n$5\n```");
    });

    it("still renders \\(…\\) maths after the rewrite", () => {
      expect(normaliseLatexFallbacks("pay $5 for \\(x\\)")).toBe("pay \\$5 for $x$");
    });
  });
});
