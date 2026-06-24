// Models often emit LaTeX that our markdown + KaTeX pipeline won't render as
// authored, so it leaks into the transcript as raw text. This module rewrites
// those cases to renderable equivalents, as a pure transform on the markdown
// source run before it is parsed — necessary for the maths delimiters because
// CommonMark strips the backslash from `\(` / `\[` as escaped punctuation during
// tokenisation, so a remark plugin would see neither. Code is left untouched:
// the scan matches fenced and inline code first and passes it through, rewriting
// only what falls outside code.

// Bare LaTeX text-wrapper commands — e.g. a `\boxed{…}` "final answer" a model
// adds outside maths — leak as raw text. Each entry maps a command to the
// markdown that wraps its inner text. Only commands listed here are unwrapped;
// anything else (`\frac`, `\sqrt`, `\href`, bare symbols) is left untouched,
// since stripping the braces would corrupt a multi-argument or symbol command.
const COMMAND_WRAP: Record<string, readonly [string, string]> = {
  boxed: ["**", "**"],
  textbf: ["**", "**"],
  mathbf: ["**", "**"],
  textit: ["*", "*"],
  emph: ["*", "*"],
  mathit: ["*", "*"],
  text: ["", ""],
  textrm: ["", ""],
  mathrm: ["", ""],
  operatorname: ["", ""],
  underline: ["", ""],
};

// One pass: a code region (passed through untouched), an inline `\(…\)` or
// display `\[…\]` maths delimiter, or a `\command{…}` wrapper with non-nested
// braces. The code alternatives come first so a delimiter or command inside
// code is never rewritten.
const FALLBACK =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\\([a-zA-Z]+)\{([^{}]*)\}/g;

/**
 * Rewrite the LaTeX a model emits that our pipeline won't otherwise render, to
 * renderable equivalents, leaving code and existing `$` maths untouched. A pure
 * transform on markdown source, run before parsing: normalises maths delimiters
 * (`\(x\)` → `$x$`, `\[x\]` → `$$x$$`) and unwraps known bare text commands
 * (`\boxed{a}` → `**a**`, `\text{a}` → `a`); unknown commands pass through.
 */
export function normaliseLatexFallbacks(source: string): string {
  return source.replace(
    FALLBACK,
    (
      match: string,
      code?: string,
      inline?: string,
      display?: string,
      command?: string,
      content?: string,
    ) => {
      if (code !== undefined) return match;
      if (inline !== undefined) return `$${inline}$`;
      if (display !== undefined) return `$$${display}$$`;
      const wrap = COMMAND_WRAP[command ?? ""];
      return wrap === undefined ? match : `${wrap[0]}${content}${wrap[1]}`;
    },
  );
}
