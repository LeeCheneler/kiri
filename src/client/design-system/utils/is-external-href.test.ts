import { describe, expect, it } from "bun:test";
import { isExternalHref } from "./is-external-href.ts";

describe("isExternalHref", () => {
  it("treats an empty href as internal", () => {
    expect(isExternalHref("")).toBe(false);
  });

  it("treats in-app paths and fragments as internal", () => {
    expect(isExternalHref("/runs/1")).toBe(false);
    expect(isExternalHref("#top")).toBe(false);
  });

  it("treats a same-origin absolute URL as internal", () => {
    expect(isExternalHref(`${window.location.origin}/runs/1`)).toBe(false);
  });

  it("treats a different-origin URL as external", () => {
    expect(isExternalHref("https://github.com/x")).toBe(true);
    expect(isExternalHref("mailto:hi@example.com")).toBe(true);
  });

  it("treats the hosted /docs site as external, even at the same origin", () => {
    expect(isExternalHref("/docs")).toBe(true);
    expect(isExternalHref("/docs/managing-kiri")).toBe(true);
    expect(isExternalHref(`${window.location.origin}/docs`)).toBe(true);
  });

  it("does not treat a route that merely starts with 'docs' as the docs site", () => {
    expect(isExternalHref("/docsetup")).toBe(false);
  });

  it("treats a malformed href as internal rather than throwing", () => {
    expect(isExternalHref("http://[invalid")).toBe(false);
  });
});
