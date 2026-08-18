import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  box,
  c,
  colorEnabled,
  createLogger,
  fact,
  printRows,
  setColorEnabled,
  stripAnsi,
} from "./log.ts";

describe("colorEnabled", () => {
  it("follows the TTY when no env override is set", () => {
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
  });

  it("NO_COLOR wins over everything", () => {
    expect(colorEnabled({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    // An empty NO_COLOR is treated as unset, per the convention.
    expect(colorEnabled({ NO_COLOR: "" }, true)).toBe(true);
  });

  it("FORCE_COLOR turns colour on off a TTY, unless it is 0", () => {
    expect(colorEnabled({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: "0" }, true)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: "0" }, false)).toBe(false);
  });

  it("uses process defaults when called with no arguments", () => {
    expect(typeof colorEnabled()).toBe("boolean");
  });
});

describe("paint + stripAnsi", () => {
  afterEach(() => setColorEnabled(false));

  it("wraps text in escapes only when colour is enabled", () => {
    setColorEnabled(false);
    expect(c.red("x")).toBe("x");
    setColorEnabled(true);
    expect(c.red("x")).toBe("\x1b[31mx\x1b[0m");
    expect(stripAnsi(c.bold(c.dim("y")))).toBe("y");
  });

  it("every painter round-trips through stripAnsi", () => {
    setColorEnabled(true);
    for (const paint of Object.values(c)) {
      expect(paint("z")).not.toBe("z");
      expect(stripAnsi(paint("z"))).toBe("z");
    }
  });
});

describe("createLogger", () => {
  let logs: string[];
  let warns: string[];
  let errs: unknown[][];
  let orig: { log: typeof console.log; warn: typeof console.warn; error: typeof console.error };

  beforeEach(() => {
    setColorEnabled(false);
    logs = [];
    warns = [];
    errs = [];
    orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errs.push(args);
    };
  });

  afterEach(() => {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  });

  it("routes each level to its console stream behind a padded feature prefix", () => {
    const log = createLogger("mcp");
    log.info("connected 1/1");
    log.warn("needs sign-in");
    log.error("failed");
    expect(logs).toEqual(["mcp       connected 1/1"]);
    expect(warns).toEqual(["mcp       warn needs sign-in"]);
    expect(errs).toEqual([["mcp       error failed"]]);
  });

  it("passes an error cause through verbatim so its stack survives", () => {
    const cause = new Error("boom");
    createLogger("http").error("unhandled", cause);
    expect(errs).toEqual([["http      error unhandled", cause]]);
  });
});

describe("box", () => {
  beforeEach(() => setColorEnabled(false));

  it("frames the lines at the minimum width with a titled top border", () => {
    const rows = box(["a", "bb"], { title: "t", columns: 80 });
    expect(rows[0]).toBe(`╭─ t ${"─".repeat(42)}╮`);
    expect(rows[1]).toBe(`│  a${" ".repeat(43)}│`);
    expect(rows[2]).toBe(`│  bb${" ".repeat(42)}│`);
    expect(rows[3]).toBe(`╰${"─".repeat(46)}╯`);
    // Every row is the same visible width.
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it("grows to the widest line and works without a title", () => {
    const rows = box(["x".repeat(60)], { columns: 100 });
    expect(rows[0]).toBe(`╭${"─".repeat(64)}╮`);
    expect(rows[1]).toBe(`│  ${"x".repeat(60)}  │`);
  });

  it("truncates lines that would overflow the terminal instead of wrapping", () => {
    const rows = box(["x".repeat(200)], { columns: 60 });
    expect(rows[1].endsWith("...  │")).toBe(true);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    expect(rows[1].length).toBe(58);
  });

  it("keeps colour through a truncation and resets before the ellipsis", () => {
    setColorEnabled(true);
    const rows = box([`${c.red("●")} ${"x".repeat(200)}`], { columns: 60 });
    expect(rows[1]).toContain("\x1b[31m●\x1b[0m");
    expect(rows[1]).toContain("x\x1b[0m...");
    expect(stripAnsi(rows[1]).length).toBe(58);
  });

  it("measures painted lines by their visible width", () => {
    setColorEnabled(true);
    const rows = box([c.red("abc")], { columns: 80 });
    expect(new Set(rows.map((r) => stripAnsi(r).length)).size).toBe(1);
  });

  it("falls back to a fixed width when the terminal width is unknown", () => {
    const rows = box(["x".repeat(200)], { columns: undefined });
    expect(stripAnsi(rows[1]).length).toBe(98);
  });
});

describe("printRows + fact", () => {
  it("prints one console line per row", () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      printRows(["one", "two"]);
    } finally {
      console.log = orig;
    }
    expect(logs).toEqual(["one", "two"]);
  });

  it("pads the label to a fixed column", () => {
    setColorEnabled(false);
    expect(fact("mcp", "2/3")).toBe("mcp        2/3");
    expect(fact("mcp", "2/3", 4)).toBe("mcp  2/3");
  });
});
