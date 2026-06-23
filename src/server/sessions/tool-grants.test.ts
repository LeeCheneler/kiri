import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolGrantStore } from "./tool-grants.ts";

describe("createToolGrantStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-grants-"));
    filePath = join(dir, "tool-grants.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads back empty for an untouched store and writes no file", () => {
    const store = createToolGrantStore(filePath);
    expect(store.isGranted("tavily__search")).toBe(false);
    expect(store.list()).toEqual([]);
    expect(existsSync(filePath)).toBe(false);
  });

  it("persists a grant so a later store sees it", () => {
    createToolGrantStore(filePath).grant("tavily__search");
    // A fresh store (a later request, or after a restart) reads the persisted grant.
    const reopened = createToolGrantStore(filePath);
    expect(reopened.isGranted("tavily__search")).toBe(true);
    expect(reopened.list()).toEqual(["tavily__search"]);
  });

  it("only grants the named tool, not its siblings", () => {
    const store = createToolGrantStore(filePath);
    store.grant("linear__create_issue");
    expect(store.isGranted("linear__create_issue")).toBe(true);
    expect(store.isGranted("linear__list_issues")).toBe(false);
  });

  it("keeps grants for multiple tools side by side", () => {
    const store = createToolGrantStore(filePath);
    store.grant("tavily__search");
    store.grant("linear__create_issue");
    expect(store.list().sort()).toEqual(["linear__create_issue", "tavily__search"]);
  });

  it("is idempotent: re-granting keeps the original timestamp", () => {
    const store = createToolGrantStore(filePath);
    store.grant("tavily__search");
    const first = readFileSync(filePath, "utf8");
    store.grant("tavily__search");
    expect(readFileSync(filePath, "utf8")).toBe(first);
    expect(store.list()).toEqual(["tavily__search"]);
  });

  it("records when the grant was made", () => {
    const store = createToolGrantStore(filePath);
    store.grant("tavily__search");
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      { grantedAt: string }
    >;
    expect(typeof data.tavily__search.grantedAt).toBe("string");
    expect(Number.isNaN(Date.parse(data.tavily__search.grantedAt))).toBe(false);
  });

  it("reflects a hand-edit that revokes a grant without a restart", () => {
    const store = createToolGrantStore(filePath);
    store.grant("tavily__search");
    expect(store.isGranted("tavily__search")).toBe(true);
    // Simulate the user deleting the entry from the file by hand.
    rmSync(filePath);
    expect(store.isGranted("tavily__search")).toBe(false);
  });

  it("creates a missing parent directory when granting", () => {
    const nested = join(dir, "deep", "tool-grants.json");
    createToolGrantStore(nested).grant("tavily__search");
    expect(existsSync(nested)).toBe(true);
  });

  it("rejects a file whose contents don't match the grants schema", () => {
    writeFileSync(filePath, JSON.stringify({ tavily__search: "yes" }));
    expect(() => createToolGrantStore(filePath).isGranted("tavily__search")).toThrow();
  });
});
