import { beforeEach, describe, expect, it } from "bun:test";
import {
  SUGGESTED_REPLIES_TTL_MS,
  readSuggestedReplies,
  writeSuggestedReplies,
} from "./suggested-replies-cache.ts";

const STORAGE_KEY = "kiri:suggested-replies";

describe("suggested replies cache", () => {
  beforeEach(() => localStorage.clear());

  it("misses for a message never asked about", () => {
    expect(readSuggestedReplies("m1")).toBeUndefined();
  });

  it("round-trips a written answer", () => {
    writeSuggestedReplies("m1", ["Yes, proceed", "No, hold off"]);
    expect(readSuggestedReplies("m1")).toEqual(["Yes, proceed", "No, hold off"]);
  });

  it("keeps an empty answer as a cached fact, not a miss", () => {
    writeSuggestedReplies("m1", []);
    expect(readSuggestedReplies("m1")).toEqual([]);
  });

  it("misses for an entry older than the TTL", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ m1: { replies: ["Yes"], at: Date.now() - SUGGESTED_REPLIES_TTL_MS - 1 } }),
    );
    expect(readSuggestedReplies("m1")).toBeUndefined();
  });

  it("prunes aged-out entries as it writes", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stale: { replies: ["Old"], at: Date.now() - SUGGESTED_REPLIES_TTL_MS - 1 },
        fresh: { replies: ["Kept"], at: Date.now() },
      }),
    );
    writeSuggestedReplies("m1", ["Yes"]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["fresh", "m1"]);
  });

  it("treats malformed stored state as empty", () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    expect(readSuggestedReplies("m1")).toBeUndefined();
    writeSuggestedReplies("m1", ["Yes"]);
    expect(readSuggestedReplies("m1")).toEqual(["Yes"]);

    localStorage.setItem(STORAGE_KEY, "null");
    expect(readSuggestedReplies("m1")).toBeUndefined();
  });
});
