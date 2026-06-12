import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConfigDir } from "./config-dir.ts";

describe("resolveConfigDir", () => {
  it("falls back to cwd when KIRI_CONFIG_DIR is unset", () => {
    expect(resolveConfigDir({}, "/work/here")).toBe("/work/here");
  });

  it("ignores an empty KIRI_CONFIG_DIR", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "" }, "/work/here")).toBe("/work/here");
  });

  it("uses an absolute KIRI_CONFIG_DIR verbatim", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "/srv/kiri-me" }, "/work/here")).toBe(
      "/srv/kiri-me",
    );
  });

  it("resolves a relative KIRI_CONFIG_DIR against process cwd", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "kiri-me" }, "/work/here")).toBe(resolve("kiri-me"));
  });

  it("expands a leading ~/ to the home directory", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "~/projects/kiri-me" }, "/work/here")).toBe(
      join(homedir(), "projects/kiri-me"),
    );
  });

  it("expands a bare ~ to the home directory", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "~" }, "/work/here")).toBe(homedir());
  });

  it("does not expand a tilde that isn't a path prefix", () => {
    expect(resolveConfigDir({ KIRI_CONFIG_DIR: "/tmp/~backup" }, "/work/here")).toBe(
      "/tmp/~backup",
    );
  });
});
