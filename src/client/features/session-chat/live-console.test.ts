import { describe, expect, it } from "bun:test";
import type { DataUIPart, UIDataTypes } from "ai";
import { createLiveConsoleStore, liveConsoleOf } from "./live-console.ts";

describe("createLiveConsoleStore", () => {
  it("stores a call's latest snapshot and notifies subscribers", () => {
    const store = createLiveConsoleStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.set("c1", { text: "one\n", truncated: false });
    store.set("c1", { text: "one\ntwo\n", truncated: false });

    expect(store.get("c1")).toEqual({ text: "one\ntwo\n", truncated: false });
    expect(store.get("other")).toBeUndefined();
    expect(notified).toBe(2);
  });

  it("clears every snapshot, notifying only when there was something to drop", () => {
    const store = createLiveConsoleStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    // Clearing an empty store is a no-op — no wasted re-renders.
    store.clear();
    expect(notified).toBe(0);

    store.set("c1", { text: "out", truncated: false });
    store.clear();
    expect(store.get("c1")).toBeUndefined();
    expect(notified).toBe(2);
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createLiveConsoleStore();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    unsubscribe();
    store.set("c1", { text: "out", truncated: false });
    expect(notified).toBe(0);
  });
});

describe("liveConsoleOf", () => {
  const part = (overrides: Record<string, unknown>): DataUIPart<UIDataTypes> =>
    ({
      type: "data-tool-console",
      id: "c1",
      data: { text: "out\n", truncated: false },
      ...overrides,
    }) as DataUIPart<UIDataTypes>;

  it("reads a console update off the part, defaulting a missing truncated flag", () => {
    expect(liveConsoleOf(part({}))).toEqual({
      toolCallId: "c1",
      snapshot: { text: "out\n", truncated: false },
    });
    expect(liveConsoleOf(part({ data: { text: "tail", truncated: true } }))).toEqual({
      toolCallId: "c1",
      snapshot: { text: "tail", truncated: true },
    });
    expect(liveConsoleOf(part({ data: { text: "tail" } }))?.snapshot.truncated).toBe(false);
  });

  it("ignores other data parts and malformed payloads", () => {
    expect(liveConsoleOf(part({ type: "data-something-else" }))).toBeNull();
    expect(liveConsoleOf(part({ id: undefined }))).toBeNull();
    expect(liveConsoleOf(part({ data: { text: 42 } }))).toBeNull();
    expect(liveConsoleOf(part({ data: null }))).toBeNull();
  });
});
