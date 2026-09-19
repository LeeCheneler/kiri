import { describe, expect, it } from "bun:test";
import { compactWriteOutput } from "./write-tool-diffs.ts";

describe("compactWriteOutput", () => {
  it("drops the diff fields, keeping the metadata", () => {
    expect(
      compactWriteOutput({
        path: "/ws/a.md",
        replacements: 2,
        diff: "-a\n+b",
        diffTruncated: true,
      }),
    ).toEqual({ path: "/ws/a.md", replacements: 2 });
  });

  it("returns diff-less outputs unchanged, by identity", () => {
    const output = { path: "/ws/a.md", created: true };
    expect(compactWriteOutput(output)).toBe(output);
    expect(compactWriteOutput("plain text")).toBe("plain text");
    expect(compactWriteOutput(null)).toBe(null);
  });
});
