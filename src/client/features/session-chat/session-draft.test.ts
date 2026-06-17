import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "./session-draft.ts";

describe("session draft storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns an empty string when nothing is saved", () => {
    expect(readSessionDraft("s1")).toBe("");
  });

  it("round-trips a draft for a session", () => {
    writeSessionDraft("s1", "half a thought");
    expect(readSessionDraft("s1")).toBe("half a thought");
  });

  it("keeps drafts separate per session", () => {
    writeSessionDraft("s1", "one");
    writeSessionDraft("s2", "two");
    expect(readSessionDraft("s1")).toBe("one");
    expect(readSessionDraft("s2")).toBe("two");
  });

  it("clears the key when a draft is written empty", () => {
    writeSessionDraft("s1", "typing");
    writeSessionDraft("s1", "");
    expect(readSessionDraft("s1")).toBe("");
  });

  it("clears a saved draft", () => {
    writeSessionDraft("s1", "typing");
    clearSessionDraft("s1");
    expect(readSessionDraft("s1")).toBe("");
  });
});
