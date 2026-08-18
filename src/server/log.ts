/**
 * Console logging for the kiri server process: coloured per-feature prefixes
 * and the boxed launch screen printed at boot.
 *
 * Deliberately tiny — hand-rolled ANSI rather than a colour dependency. Every
 * line still goes through `console.log` / `console.warn` / `console.error`
 * (looked up at call time) so tests can keep spying on the console, and the
 * message body is never split by escape codes, so substring assertions hold.
 */

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
const ANSI_ESCAPE_GLOBAL = /\x1b\[[0-9;]*m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
const ANSI_ESCAPE_AT_START = /^\x1b\[[0-9;]*m/;

/**
 * Colour is on for a TTY unless `NO_COLOR` is set; `FORCE_COLOR` turns it on
 * regardless (piped output under `concurrently` in `bun run dev`, CI logs).
 */
export function colorEnabled(
  env: Record<string, string | undefined> = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return isTTY;
}

let enabled = colorEnabled();

/** Override colour output — used by tests and by `--no-color` style switches. */
export function setColorEnabled(value: boolean): void {
  enabled = value;
}

function paint(code: number, text: string): string {
  return enabled ? `${ESC}${code}m${text}${RESET}` : text;
}

export const c = {
  bold: (s: string) => paint(1, s),
  dim: (s: string) => paint(2, s),
  red: (s: string) => paint(31, s),
  green: (s: string) => paint(32, s),
  yellow: (s: string) => paint(33, s),
  blue: (s: string) => paint(34, s),
  magenta: (s: string) => paint(35, s),
  cyan: (s: string) => paint(36, s),
  gray: (s: string) => paint(90, s),
};

/** Strip ANSI escapes — needed to measure a painted string's visible width. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_GLOBAL, "");
}

/**
 * The features that log, each with a fixed colour so a prefix is recognisable
 * at a glance across restarts. Add here rather than inventing ad-hoc prefixes.
 */
export const FEATURES = {
  config: c.magenta,
  mcp: c.blue,
  workflows: c.cyan,
  runs: c.cyan,
  sessions: c.yellow,
  shell: c.yellow,
  events: c.gray,
  http: c.red,
} as const;

export type Feature = keyof typeof FEATURES;

const PREFIX_WIDTH = Math.max(...Object.keys(FEATURES).map((f) => f.length));

function prefix(feature: Feature): string {
  return FEATURES[feature](feature.padEnd(PREFIX_WIDTH));
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  /** `cause` is passed through to the console verbatim so an Error keeps its stack. */
  error(message: string, cause?: unknown): void;
}

/**
 * A logger for one feature. `info` → stdout, `warn`/`error` → stderr with a
 * coloured level marker, all behind the feature's prefix.
 */
export function createLogger(feature: Feature): Logger {
  return {
    info: (message) => console.log(`${prefix(feature)} ${message}`),
    warn: (message) => console.warn(`${prefix(feature)} ${c.yellow("warn")} ${message}`),
    error: (message, cause) => {
      const line = `${prefix(feature)} ${c.red("error")} ${message}`;
      if (cause === undefined) console.error(line);
      else console.error(line, cause);
    },
  };
}

// ---------------------------------------------------------------------------
// Boxes

const MIN_BOX_WIDTH = 48;

/**
 * Widest a box may be: the terminal width, minus a margin, or a fixed cap when
 * there's no terminal to measure. Lines longer than this are truncated with an
 * ellipsis rather than wrapped — box borders don't survive soft wraps.
 */
function maxBoxWidth(columns: number | undefined = process.stdout.columns): number {
  return Math.max(MIN_BOX_WIDTH, Math.min(columns ?? 100, 120) - 2);
}

// ASCII on purpose: U+2026 is ambiguous-width and renders two cells in some
// terminals, which knocks the box border out of line.
const ELLIPSIS = "...";

/**
 * Cut `line` to `visibleMax` visible characters plus an ellipsis, carrying
 * escape sequences through untouched so colours survive and closing with a
 * reset so nothing bleeds into the border.
 */
function truncate(line: string, visibleMax: number): string {
  if (stripAnsi(line).length <= visibleMax) return line;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < visibleMax - ELLIPSIS.length) {
    const sequence = ANSI_ESCAPE_AT_START.exec(line.slice(i));
    if (sequence) {
      out += sequence[0];
      i += sequence[0].length;
    } else {
      out += line[i];
      visible += 1;
      i += 1;
    }
  }
  return `${out}${enabled ? RESET : ""}${ELLIPSIS}`;
}

/**
 * Render a rounded box around `lines`, one entry per row, with an optional
 * title inlaid in the top border. Returns the rows (unjoined) so callers can
 * decide how to print. `tint` colours the frame.
 */
export function box(
  lines: readonly string[],
  {
    title,
    tint = c.gray,
    columns,
  }: { title?: string; tint?: (s: string) => string; columns?: number } = {},
): string[] {
  const max = maxBoxWidth(columns);
  const rows = lines.map((line) => truncate(line, max - 6));
  const titleWidth = title ? title.length + 3 : 0;
  const inner = Math.min(
    max - 2,
    Math.max(MIN_BOX_WIDTH - 2, titleWidth + 2, ...rows.map((r) => stripAnsi(r).length + 4)),
  );
  const top = title
    ? `${tint("╭─ ")}${c.bold(title)}${tint(` ${"─".repeat(inner - titleWidth)}╮`)}`
    : tint(`╭${"─".repeat(inner)}╮`);
  const body = rows.map((row) => {
    const pad = " ".repeat(inner - 4 - stripAnsi(row).length);
    return `${tint("│")}  ${row}${pad}  ${tint("│")}`;
  });
  return [top, ...body, tint(`╰${"─".repeat(inner)}╯`)];
}

/** Print each row of a box (or any block of rows) on its own console line. */
export function printRows(rows: readonly string[]): void {
  for (const row of rows) console.log(row);
}

/** `label   value` — a labelled fact row for inside a box. */
export function fact(label: string, value: string, width = 10): string {
  return `${c.dim(label.padEnd(width))} ${value}`;
}
