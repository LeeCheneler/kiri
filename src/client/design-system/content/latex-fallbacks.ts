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
  return escapeCurrencyDollars(rewriteLatex(source));
}

function rewriteLatex(source: string): string {
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

// Code regions alone, for the dollar pass: a `$` inside code is never maths.
const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g;

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Escape the lone `$` that is currency, not maths. micromark pairs any two
 * single `$` in a paragraph, so prose like "$400m … was $150" typesets
 * everything between them. Pandoc's rule tells the two apart: a `$` opens
 * maths only when it has a non-space to its right and a closer exists with a
 * non-space to its left and no digit to its right. A `$` with no such closer
 * is currency and is escaped to `\$`, which CommonMark renders literally.
 * `$$` sequences and code are left untouched.
 */
function escapeCurrencyDollars(source: string): string {
  let out = "";
  let last = 0;
  for (const match of source.matchAll(CODE)) {
    out += escapeDollarsInText(source.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + escapeDollarsInText(source.slice(last));
}

function escapeDollarsInText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // A backslash escape (`\$`, `\\`) is already literal; copy it whole.
    if (ch === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    let end = i;
    while (text[end] === "$") end++;
    if (end - i > 1) {
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const closer = findMathCloser(text, end);
    if (closer === -1) {
      out += "\\$";
    } else {
      out += text.slice(i, closer + 1);
      i = closer + 1;
      continue;
    }
    i = end;
  }
  return out;
}

// The index of the `$` closing maths opened just before `from`, or -1 when
// the opener is currency. The search stops at a blank line (maths can't span
// paragraphs), a `$$`, or another opener-shaped `$` — a space on its left and
// a non-space on its right — since that one starts its own candidate.
function findMathCloser(text: string, from: number): number {
  if (isSpace(text[from])) return -1;
  let k = from;
  while (k < text.length) {
    const ch = text[k];
    if (ch === "\\") {
      k += 2;
      continue;
    }
    if (ch === "\n" && /^\s*\n/.test(text.slice(k + 1))) return -1;
    if (ch !== "$") {
      k++;
      continue;
    }
    if (text[k + 1] === "$") return -1;
    const before = text[k - 1];
    const after = text[k + 1];
    if (!isSpace(before) && !isDigit(after)) return k;
    if (isSpace(before) && !isSpace(after)) return -1;
    k++;
  }
  return -1;
}
