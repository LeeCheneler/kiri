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
});
