import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolPermissionStore } from "./tool-permissions.ts";

describe("createToolPermissionStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-perms-"));
    filePath = join(dir, "tool-permissions.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to ask for an untouched store and writes no file", () => {
    const store = createToolPermissionStore(filePath);
    expect(store.get("tavily__search")).toBe("ask");
    expect(store.list()).toEqual({});
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns the caller's fallback for an unrecorded tool", () => {
    const store = createToolPermissionStore(filePath);
    expect(store.get("create_article", "allow")).toBe("allow");
    expect(store.get("run_workflow", "ask")).toBe("ask");
  });

  it("prefers a recorded decision over the fallback", () => {
    const store = createToolPermissionStore(filePath);
    store.set("create_article", "off");
    expect(store.get("create_article", "allow")).toBe("off");
  });

  it("persists an explicit ask so it overrides an allow fallback", () => {
    const store = createToolPermissionStore(filePath);
    store.set("create_article", "ask");
    // A fresh store still sees the decision: ask must stick for a tool whose
    // fallback is allow, so it is recorded rather than treated as clearing.
    expect(createToolPermissionStore(filePath).get("create_article", "allow")).toBe("ask");
  });

  it("persists allow and off so a later store sees them", () => {
    const store = createToolPermissionStore(filePath);
    store.set("tavily__search", "allow");
    store.set("linear__create_issue", "off");
    // A fresh store (a later request, or after a restart) reads the persisted decisions.
    const reopened = createToolPermissionStore(filePath);
    expect(reopened.get("tavily__search")).toBe("allow");
    expect(reopened.get("linear__create_issue")).toBe("off");
    expect(reopened.list()).toEqual({ tavily__search: "allow", linear__create_issue: "off" });
  });

  it("records a change back to ask alongside the other decisions", () => {
    const store = createToolPermissionStore(filePath);
    store.set("tavily__search", "off");
    store.set("tavily__search", "ask");
    expect(store.get("tavily__search")).toBe("ask");
    expect(store.list()).toEqual({ tavily__search: "ask" });
  });

  it("only changes the named tool, not its siblings", () => {
    const store = createToolPermissionStore(filePath);
    store.set("linear__create_issue", "off");
    expect(store.get("linear__create_issue")).toBe("off");
    expect(store.get("linear__list_issues")).toBe("ask");
  });

  it("is idempotent: re-setting the same permission leaves the file untouched", () => {
    const store = createToolPermissionStore(filePath);
    store.set("tavily__search", "allow");
    const first = readFileSync(filePath, "utf8");
    store.set("tavily__search", "allow");
    expect(readFileSync(filePath, "utf8")).toBe(first);
  });

  it("records when the decision was made", () => {
    const store = createToolPermissionStore(filePath);
    store.set("tavily__search", "off");
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      { decidedAt: string }
    >;
    expect(Number.isNaN(Date.parse(data.tavily__search.decidedAt))).toBe(false);
  });

  it("reflects a hand-edit that removes a decision without a restart", () => {
    const store = createToolPermissionStore(filePath);
    store.set("tavily__search", "off");
    expect(store.get("tavily__search")).toBe("off");
    // Simulate the user deleting the file by hand.
    rmSync(filePath);
    expect(store.get("tavily__search")).toBe("ask");
  });

  it("creates a missing parent directory when setting", () => {
    const nested = join(dir, "deep", "tool-permissions.json");
    createToolPermissionStore(nested).set("tavily__search", "off");
    expect(existsSync(nested)).toBe(true);
  });

  it("rejects a file whose contents don't match the permissions schema", () => {
    writeFileSync(filePath, JSON.stringify({ tavily__search: "allow" }));
    expect(() => createToolPermissionStore(filePath).get("tavily__search")).toThrow();
  });
});
