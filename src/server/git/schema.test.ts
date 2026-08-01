import { describe, expect, it } from "bun:test";
import { gitSchema } from "./schema.ts";

describe("gitSchema", () => {
  it("parses a section with roots only", () => {
    const result = gitSchema.parse({ roots: ["~/projects/personal"] });
    expect(result).toEqual({ roots: ["~/projects/personal"] });
  });

  it("parses an empty roots list", () => {
    expect(gitSchema.parse({ roots: [] }).roots).toEqual([]);
  });

  it("parses full defaults with prepare", () => {
    const result = gitSchema.parse({
      roots: ["~/code"],
      defaults: {
        prepare: { env: "symlink", install: "auto", postCreate: ["mise trust"] },
      },
    });
    expect(result.defaults?.prepare).toEqual({
      env: "symlink",
      install: "auto",
      postCreate: ["mise trust"],
    });
  });

  it("parses per-repo overrides keyed by directory name", () => {
    const result = gitSchema.parse({
      roots: ["~/code"],
      repos: { kiri: { prepare: { postCreate: ["mise trust"] } } },
    });
    expect(result.repos?.kiri).toEqual({ prepare: { postCreate: ["mise trust"] } });
  });

  it("treats a copy env and an off install as valid", () => {
    const result = gitSchema.parse({
      roots: ["."],
      defaults: { prepare: { env: "copy", install: "off" } },
    });
    expect(result.defaults?.prepare).toEqual({ env: "copy", install: "off" });
  });

  it("requires roots", () => {
    const result = gitSchema.safeParse({ defaults: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["roots"]);
  });

  it("rejects an empty root entry", () => {
    expect(() => gitSchema.parse({ roots: [""] })).toThrow();
  });

  it("rejects an unknown top-level worktrees key (strict)", () => {
    expect(() => gitSchema.parse({ roots: [], junk: true })).toThrow();
  });

  it("rejects an unknown prepare key (strict)", () => {
    expect(() => gitSchema.parse({ roots: [], defaults: { prepare: { junk: true } } })).toThrow();
  });

  it("rejects an unknown override key (strict)", () => {
    expect(() => gitSchema.parse({ roots: [], defaults: { junk: true } })).toThrow();
  });

  it("rejects an invalid env value", () => {
    expect(() =>
      gitSchema.parse({ roots: [], defaults: { prepare: { env: "hardlink" } } }),
    ).toThrow();
  });

  it("rejects an invalid install value", () => {
    expect(() =>
      gitSchema.parse({ roots: [], defaults: { prepare: { install: "sometimes" } } }),
    ).toThrow();
  });

  it("rejects an empty repo key", () => {
    expect(() => gitSchema.parse({ roots: [], repos: { "": {} } })).toThrow();
  });

  it("rejects an empty postCreate entry", () => {
    expect(() =>
      gitSchema.parse({ roots: [], defaults: { prepare: { postCreate: [""] } } }),
    ).toThrow();
  });
});
