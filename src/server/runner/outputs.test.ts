import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestStepOutputs, runOutputCommand } from "./outputs.ts";

describe("runOutputCommand", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-out-"));
    file = join(dir, "outputs.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const readLines = () =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));

  it("appends one JSON line per call and exits zero", () => {
    expect(runOutputCommand(["url", "https://example.com"], { KIRI_OUTPUTS_FILE: file })).toEqual({
      exitCode: 0,
    });
    expect(runOutputCommand(["count", "3"], { KIRI_OUTPUTS_FILE: file })).toEqual({ exitCode: 0 });

    expect(readLines()).toEqual([
      { name: "url", value: "https://example.com" },
      { name: "count", value: "3" },
    ]);
  });

  it("round-trips values containing newlines, quotes, and non-ASCII text", () => {
    const value = 'line one\nline "two"\n\ttab — ünïcode';
    expect(runOutputCommand(["body", value], { KIRI_OUTPUTS_FILE: file }).exitCode).toBe(0);
    expect(readLines()).toEqual([{ name: "body", value }]);
  });

  it("accepts an empty string value", () => {
    expect(runOutputCommand(["empty", ""], { KIRI_OUTPUTS_FILE: file }).exitCode).toBe(0);
    expect(readLines()).toEqual([{ name: "empty", value: "" }]);
  });

  it.each([[[] as string[]], [["only-name"]], [["name", "value", "stray"]]])(
    "rejects an argument count other than two without writing: %p",
    (args) => {
      const result = runOutputCommand(args, { KIRI_OUTPUTS_FILE: file });
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("usage: kiri-output <name> <value>");
      expect(existsSync(file)).toBe(false);
    },
  );

  it.each([[undefined], [""]])("fails without writing when KIRI_OUTPUTS_FILE is %p", (envValue) => {
    const result = runOutputCommand(["name", "value"], { KIRI_OUTPUTS_FILE: envValue });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("KIRI_OUTPUTS_FILE is not set");
    expect(result.error).toContain("declares outputs:");
    expect(existsSync(file)).toBe(false);
  });

  it.each([["Upper"], ["1starts-with-digit"], ["has space"], ["-leading-hyphen"], ["dotted.name"]])(
    "rejects the invalid output name %p without writing",
    (name) => {
      const result = runOutputCommand([name, "value"], { KIRI_OUTPUTS_FILE: file });
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain(`invalid output name "${name}"`);
      expect(result.error).toContain("^[a-z][a-z0-9_-]*$");
      expect(existsSync(file)).toBe(false);
    },
  );

  it.each([["a"], ["a-b_c9"], ["pr_number"]])("accepts the valid output name %p", (name) => {
    expect(runOutputCommand([name, "v"], { KIRI_OUTPUTS_FILE: file }).exitCode).toBe(0);
  });
});

describe("ingestStepOutputs", () => {
  let dir: string;
  let file: string;
  const runId = "run-test";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-out-ingest-"));
    file = join(dir, "outputs.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const withSilencedWarn = <T>(fn: () => T): { result: T; warnings: string[] } => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = original;
    }
  };

  const writeLines = (lines: string[]): void => {
    writeFileSync(file, `${lines.join("\n")}\n`);
  };

  it("reports every declared name missing when the file does not exist", () => {
    expect(ingestStepOutputs(runId, file, ["url", "count"])).toEqual({
      outputs: {},
      missing: ["url", "count"],
    });
  });

  it("resolves every declared name when all are emitted", () => {
    writeLines([
      JSON.stringify({ name: "url", value: "https://example.com" }),
      JSON.stringify({ name: "count", value: "3" }),
    ]);

    expect(ingestStepOutputs(runId, file, ["url", "count"])).toEqual({
      outputs: { url: "https://example.com", count: "3" },
      missing: [],
    });
  });

  it("lists unemitted declared names in declaration order", () => {
    writeLines([JSON.stringify({ name: "count", value: "3" })]);

    expect(ingestStepOutputs(runId, file, ["url", "count", "title"])).toEqual({
      outputs: { count: "3" },
      missing: ["url", "title"],
    });
  });

  it("keeps the last value when a name is emitted more than once", () => {
    writeLines([
      JSON.stringify({ name: "url", value: "first" }),
      JSON.stringify({ name: "url", value: "second" }),
    ]);

    expect(ingestStepOutputs(runId, file, ["url"]).outputs).toEqual({ url: "second" });
  });

  it("skips undeclared names with a warning", () => {
    writeLines([
      JSON.stringify({ name: "url", value: "kept" }),
      JSON.stringify({ name: "stray", value: "dropped" }),
    ]);

    const { result, warnings } = withSilencedWarn(() => ingestStepOutputs(runId, file, ["url"]));

    expect(result).toEqual({ outputs: { url: "kept" }, missing: [] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('undeclared output "stray"');
    expect(warnings[0]).toContain(runId);
  });

  it("skips malformed JSON and schema-failing lines without aborting the rest", () => {
    writeLines([
      "{ not json",
      JSON.stringify({ name: "url" }),
      JSON.stringify({ name: "", value: "x" }),
      JSON.stringify({ name: "url", value: "kept" }),
      "   ",
    ]);

    const { result, warnings } = withSilencedWarn(() => ingestStepOutputs(runId, file, ["url"]));

    expect(result).toEqual({ outputs: { url: "kept" }, missing: [] });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("malformed output line");
    expect(warnings[1]).toContain("failing schema");
  });

  it("accepts an emitted empty-string value as present", () => {
    writeLines([JSON.stringify({ name: "url", value: "" })]);

    expect(ingestStepOutputs(runId, file, ["url"])).toEqual({
      outputs: { url: "" },
      missing: [],
    });
  });
});
