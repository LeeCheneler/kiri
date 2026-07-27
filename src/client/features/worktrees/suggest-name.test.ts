import { describe, expect, it } from "bun:test";
import { suggestWorktreeName } from "./suggest-name.ts";

describe("suggestWorktreeName", () => {
  it("suggests a two-word, directory-safe name", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(suggestWorktreeName()).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });

  it("varies between calls rather than handing back one fixed name", () => {
    const seen = new Set(Array.from({ length: 50 }, suggestWorktreeName));
    expect(seen.size).toBeGreaterThan(1);
  });
});
