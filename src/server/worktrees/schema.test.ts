import { describe, expect, it } from "bun:test";
import { worktreesSchema } from "./schema.ts";

describe("worktreesSchema", () => {
  it("parses a section with roots only", () => {
    const result = worktreesSchema.parse({ roots: ["~/projects/personal"] });
    expect(result).toEqual({ roots: ["~/projects/personal"] });
  });

  it("parses an empty roots list", () => {
    expect(worktreesSchema.parse({ roots: [] }).roots).toEqual([]);
  });

  it("parses full defaults with prepare and cleanup", () => {
    const result = worktreesSchema.parse({
      roots: ["~/code"],
      defaults: {
        prepare: { env: "symlink", install: "auto", postCreate: ["mise trust"] },
        cleanup: { mergedPr: "suggest", fetchIntervalMinutes: 15 },
      },
    });
    expect(result.defaults?.prepare).toEqual({
      env: "symlink",
      install: "auto",
      postCreate: ["mise trust"],
    });
    expect(result.defaults?.cleanup).toEqual({ mergedPr: "suggest", fetchIntervalMinutes: 15 });
  });

  it("parses per-repo overrides keyed by directory name", () => {
    const result = worktreesSchema.parse({
      roots: ["~/code"],
      repos: { kiri: { prepare: { postCreate: ["mise trust"] } } },
    });
    expect(result.repos?.kiri).toEqual({ prepare: { postCreate: ["mise trust"] } });
  });

  it("treats a copy env and an off install as valid", () => {
    const result = worktreesSchema.parse({
      roots: ["."],
      defaults: { prepare: { env: "copy", install: "off" } },
    });
    expect(result.defaults?.prepare).toEqual({ env: "copy", install: "off" });
  });

  it("requires roots", () => {
    const result = worktreesSchema.safeParse({ defaults: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["roots"]);
  });

  it("rejects an empty root entry", () => {
    expect(() => worktreesSchema.parse({ roots: [""] })).toThrow();
  });

  it("rejects an unknown top-level worktrees key (strict)", () => {
    expect(() => worktreesSchema.parse({ roots: [], junk: true })).toThrow();
  });

  it("rejects an unknown prepare key (strict)", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { prepare: { junk: true } } }),
    ).toThrow();
  });

  it("rejects an unknown cleanup key (strict)", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { cleanup: { junk: true } } }),
    ).toThrow();
  });

  it("rejects an unknown override key (strict)", () => {
    expect(() => worktreesSchema.parse({ roots: [], defaults: { junk: true } })).toThrow();
  });

  it("rejects an invalid env value", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { prepare: { env: "hardlink" } } }),
    ).toThrow();
  });

  it("rejects an invalid install value", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { prepare: { install: "sometimes" } } }),
    ).toThrow();
  });

  it("rejects an invalid mergedPr value", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { cleanup: { mergedPr: "maybe" } } }),
    ).toThrow();
  });

  it("rejects a negative fetch interval", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { cleanup: { fetchIntervalMinutes: -1 } } }),
    ).toThrow();
  });

  it("rejects a non-integer fetch interval", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { cleanup: { fetchIntervalMinutes: 1.5 } } }),
    ).toThrow();
  });

  it("rejects an empty repo key", () => {
    expect(() => worktreesSchema.parse({ roots: [], repos: { "": {} } })).toThrow();
  });

  it("rejects an empty postCreate entry", () => {
    expect(() =>
      worktreesSchema.parse({ roots: [], defaults: { prepare: { postCreate: [""] } } }),
    ).toThrow();
  });
});
