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

  it("treats a malformed href as internal rather than throwing", () => {
    expect(isExternalHref("http://[invalid")).toBe(false);
  });
});
