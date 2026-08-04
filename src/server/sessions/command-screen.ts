// Deterministic screening for shell commands under the "auto" permission.
// Runs before any model judgement so its verdicts hold even against inputs
// crafted to sway a model: hard-ask triggers can never be overridden, the
// always-allow list is exact and metacharacter-free, and everything else is
// deferred with the comment-stripped command.

/**
 * The screen's verdict on a command: `allow` and `ask` are final, `judge`
 * defers to a model judgement of `command` — the comment-stripped form, so
 * text hidden in shell comments never reaches the judge.
 */
export type CommandScreenResult =
  | { verdict: "allow" | "ask"; reason: string }
  | { verdict: "judge"; command: string };

// Triggers that always ask, matched against the comment-stripped command.
// Matching the raw string means a trigger inside quotes or a substitution
// still fires — a false positive costs one approval click, a miss runs the
// command, so the patterns err broad.
const HARD_ASK_TRIGGERS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bsudo\b/, reason: "runs with elevated privileges" },
  { pattern: /\beval\b/, reason: "evaluates dynamically constructed shell code" },
  { pattern: /\brm\s+-{1,2}[^\s]*[rf]/, reason: "recursive or forced delete" },
  { pattern: /\bgit\s+push\b.*(--force|\s-f\b|\s\+\S)/, reason: "force-pushes git history" },
  { pattern: /\bgit\s+clean\b/, reason: "deletes untracked files" },
  { pattern: /\bgit\s+reset\b.*--hard/, reason: "discards local changes" },
  { pattern: /\|\s*(\S*\/)?(sh|bash|zsh|dash)\b/, reason: "pipes into a shell" },
  { pattern: /\bbase64\b\s+-{1,2}[^\s]*[dD]/, reason: "decodes obfuscated content" },
  { pattern: /\b(sh|bash|zsh|dash)\s+-c\b/, reason: "nests a shell with an inline script" },
];

// A command is only ever always-allowed when it is one bare word sequence:
// any shell metacharacter, quote, expansion, or glob falls through to the
// judge instead.
const METACHARACTERS = /[;&|<>`$(){}\\'"*?[\]~!\n=]/;

// Read-only commands that may run unprompted, as leading token sequences.
// Remaining tokens must be plain flags — a non-flag argument (a path, a
// count, a ref) is the judge's call.
const ALWAYS_ALLOW: string[][] = [
  ["git", "status"],
  ["git", "diff"],
  ["git", "log"],
  ["ls"],
  ["pwd"],
];

const FLAG_TOKEN = /^-[A-Za-z0-9-]*$/;

const isAlwaysAllowed = (command: string): boolean => {
  if (METACHARACTERS.test(command)) return false;
  const tokens = command.split(/\s+/).filter((t) => t.length > 0);
  return ALWAYS_ALLOW.some(
    (prefix) =>
      prefix.length <= tokens.length &&
      prefix.every((word, i) => tokens[i] === word) &&
      tokens.slice(prefix.length).every((t) => FLAG_TOKEN.test(t)),
  );
};

/**
 * Remove bash comments from `command` while respecting quoting and escapes:
 * `#` starts a comment only when unquoted and at the start of a word, exactly
 * as bash tokenizes it. Trailing whitespace the removal leaves behind is
 * trimmed per line.
 */
export function stripShellComments(command: string): string {
  let out = "";
  let single = false;
  let double = false;
  let escaped = false;
  let comment = false;
  let prev = "";
  for (const ch of command) {
    if (comment) {
      if (ch !== "\n") continue;
      comment = false;
    } else if (escaped) {
      escaped = false;
    } else if (ch === "\\" && !single) {
      escaped = true;
    } else if (ch === "'" && !double) {
      single = !single;
    } else if (ch === '"' && !single) {
      double = !double;
    } else if (ch === "#" && !single && !double && (prev === "" || /[\s;|&(]/.test(prev))) {
      comment = true;
      continue;
    }
    out += ch;
    prev = ch;
  }
  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Screen a shell command for the "auto" permission: `ask` for hard triggers a
 * model must never override, `allow` for exact-match read-only commands, and
 * otherwise `judge` carrying the comment-stripped command for the model.
 */
export function screenCommand(rawCommand: string): CommandScreenResult {
  const command = stripShellComments(rawCommand);
  for (const { pattern, reason } of HARD_ASK_TRIGGERS) {
    if (pattern.test(command)) return { verdict: "ask", reason };
  }
  if (isAlwaysAllowed(command)) {
    return { verdict: "allow", reason: "read-only command on the always-allow list" };
  }
  return { verdict: "judge", command };
}
