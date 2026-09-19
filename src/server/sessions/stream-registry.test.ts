import { describe, expect, it } from "bun:test";
import type { UIMessageChunk } from "ai";

import { createStreamRegistry } from "./stream-registry.ts";

const decoder = new TextDecoder();

const text = (delta: string): UIMessageChunk => ({ type: "text-delta", id: "t1", delta });

const consoleSnapshot = (toolCallId: string, tail: string): UIMessageChunk => ({
  type: "data-tool-console",
  id: toolCallId,
  data: { text: tail, truncated: false },
  transient: true,
});

const START: UIMessageChunk = { type: "start", messageId: "m1" };

const FINISH_STEP: UIMessageChunk = { type: "finish-step" };

const frame = (chunk: UIMessageChunk): string => `data: ${JSON.stringify(chunk)}\n\n`;

// A thin reader over a subscription: `next()` resolves to the next frame's text,
// or undefined once the stream closes.
function frames(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw new Error("expected a live stream for the session");
  const reader = stream.getReader();
  return {
    async next(): Promise<string | undefined> {
      const { value, done } = await reader.read();
      return done ? undefined : decoder.decode(value);
    },
    cancel: () => reader.cancel(),
  };
}

describe("createStreamRegistry", () => {
  it("has reflects a session's stream from open through close", () => {
    const reg = createStreamRegistry();
    expect(reg.has("s1")).toBe(false);
    const sink = reg.open("s1", 1);
    expect(reg.has("s1")).toBe(true);
    sink.close();
    expect(reg.has("s1")).toBe(false);
  });

  it("subscribe on a session with no live turn returns null", () => {
    expect(createStreamRegistry().subscribe("ghost", 1)).toBeNull();
  });

  it("a subscriber that joins before any frame receives them live", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    const out = frames(reg.subscribe("s1", 1));
    sink.push(text("a"));
    expect(await out.next()).toBe(frame(text("a")));
    sink.push(text("b"));
    expect(await out.next()).toBe(frame(text("b")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("a subscriber that joins late replays the buffer then follows live, in order", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a"));
    sink.push(text("b"));
    const out = frames(reg.subscribe("s1", 1));
    expect(await out.next()).toBe(frame(text("a")));
    expect(await out.next()).toBe(frame(text("b")));
    sink.push(text("c"));
    expect(await out.next()).toBe(frame(text("c")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("replays only the latest transient chunk of each type and id", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a"));
    sink.push(consoleSnapshot("c1", "one"));
    sink.push(consoleSnapshot("c2", "other call"));
    sink.push(text("b"));
    sink.push(consoleSnapshot("c1", "one two"));
    const out = frames(reg.subscribe("s1", 1));
    expect(await out.next()).toBe(frame(text("a")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c2", "other call")));
    expect(await out.next()).toBe(frame(text("b")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one two")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("still sends every transient chunk to a reader already following live", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    const out = frames(reg.subscribe("s1", 1));
    sink.push(consoleSnapshot("c1", "one"));
    sink.push(consoleSnapshot("c1", "one two"));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one two")));
    sink.close();
  });

  it("replays only what follows the last checkpoint, behind the stream's start", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(START);
    sink.push(text("saved"));
    sink.push(consoleSnapshot("c1", "settled call"));
    sink.push(FINISH_STEP);
    sink.checkpoint(2);
    sink.push(text("unsaved"));
    const out = frames(reg.subscribe("s1", 2));
    expect(await out.next()).toBe(frame(START));
    expect(await out.next()).toBe(frame(text("unsaved")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("ends at once for a reader holding any other revision", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a"));
    sink.checkpoint(2);
    const behind = frames(reg.subscribe("s1", 1));
    const ahead = frames(reg.subscribe("s1", 3));
    expect(await behind.next()).toBeUndefined();
    expect(await ahead.next()).toBeUndefined();
    // Neither was attached: later frames reach only a reader at the base.
    sink.push(text("b"));
    const current = frames(reg.subscribe("s1", 2));
    expect(await current.next()).toBe(frame(text("b")));
    sink.close();
  });

  it("keeps a reader already following live across a checkpoint", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    const out = frames(reg.subscribe("s1", 1));
    sink.push(text("a"));
    sink.checkpoint(2);
    sink.push(text("b"));
    expect(await out.next()).toBe(frame(text("a")));
    expect(await out.next()).toBe(frame(text("b")));
    sink.close();
  });

  it("stops replaying a step that outgrows the limit, holding a late reader until it is saved", async () => {
    const big = text("x".repeat(200));
    const reg = createStreamRegistry({ replayLimitBytes: 300 });
    const sink = reg.open("s1", 1);
    const live = frames(reg.subscribe("s1", 1));
    sink.push(START);
    sink.push(big);
    sink.push(big);

    // The step's frames no longer fit: a reader arriving now is sent nothing,
    // while the one already following live misses nothing.
    const late = frames(reg.subscribe("s1", 1));
    sink.push(text("tail"));
    sink.push(FINISH_STEP);
    sink.checkpoint(2);
    expect(await late.next()).toBeUndefined();
    for (const chunk of [START, big, big, text("tail"), FINISH_STEP]) {
      expect(await live.next()).toBe(frame(chunk));
    }

    // Saved, the step is in the transcript, and replay picks up after it.
    sink.push(text("next step"));
    const rejoined = frames(reg.subscribe("s1", 2));
    expect(await rejoined.next()).toBe(frame(START));
    expect(await rejoined.next()).toBe(frame(text("next step")));
    sink.close();
  });

  it("ends a held reader when the turn settles before the step is saved", async () => {
    const reg = createStreamRegistry({ replayLimitBytes: 10 });
    const sink = reg.open("s1", 1);
    sink.push(text("over the limit"));
    const late = frames(reg.subscribe("s1", 1));
    const gone = frames(reg.subscribe("s1", 1));
    await gone.cancel();
    sink.close();
    expect(await late.next()).toBeUndefined();
  });

  it("counts a superseded transient out of the replay limit", async () => {
    const snapshot = consoleSnapshot("c1", "y".repeat(100));
    const reg = createStreamRegistry({ replayLimitBytes: 2 * frame(snapshot).length - 1 });
    const sink = reg.open("s1", 1);
    for (let i = 0; i < 10; i += 1) sink.push(snapshot);
    const out = frames(reg.subscribe("s1", 1));
    expect(await out.next()).toBe(frame(snapshot));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("ends a reader that leaves more than its limit unread, behind what it was sent", async () => {
    const chunk = text("z".repeat(100));
    const reg = createStreamRegistry({ readerLimitBytes: 2 * frame(chunk).length });
    const sink = reg.open("s1", 1);
    const stalled = frames(reg.subscribe("s1", 1));
    const reading = frames(reg.subscribe("s1", 1));
    sink.push(chunk);
    expect(await reading.next()).toBe(frame(chunk));
    sink.push(chunk);
    expect(await reading.next()).toBe(frame(chunk));
    sink.push(chunk);
    expect(await reading.next()).toBe(frame(chunk));

    // The stalled reader was cut off at its limit; the one keeping up was not.
    expect(await stalled.next()).toBe(frame(chunk));
    expect(await stalled.next()).toBe(frame(chunk));
    expect(await stalled.next()).toBeUndefined();
    sink.close();
    expect(await reading.next()).toBeUndefined();
  });

  it("fans out the same frames to multiple subscribers", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a"));
    const one = frames(reg.subscribe("s1", 1));
    const two = frames(reg.subscribe("s1", 1));
    expect(await one.next()).toBe(frame(text("a")));
    expect(await two.next()).toBe(frame(text("a")));
    sink.push(text("b"));
    expect(await one.next()).toBe(frame(text("b")));
    expect(await two.next()).toBe(frame(text("b")));
    sink.close();
    expect(await one.next()).toBeUndefined();
    expect(await two.next()).toBeUndefined();
  });

  it("close drops the entry, so a later subscribe returns null", () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a"));
    sink.close();
    expect(reg.subscribe("s1", 1)).toBeNull();
    expect(reg.has("s1")).toBe(false);
  });

  it("close with no subscribers still drops the entry", () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    sink.push(text("a")); // buffered, never read
    sink.close();
    expect(reg.has("s1")).toBe(false);
  });

  it("a cancelled subscriber is pruned without disturbing the others", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1", 1);
    const gone = frames(reg.subscribe("s1", 1));
    const kept = frames(reg.subscribe("s1", 1));
    await gone.cancel();
    sink.push(text("a")); // must reach `kept` and not throw on the pruned controller
    expect(await kept.next()).toBe(frame(text("a")));
    sink.close();
    expect(await kept.next()).toBeUndefined();
  });

  it("re-opening a session keeps the newer stream when the old one closes", () => {
    const reg = createStreamRegistry();
    const first = reg.open("s1", 1);
    const second = reg.open("s1", 1);
    first.close(); // must not drop the entry the second open installed
    expect(reg.has("s1")).toBe(true);
    second.close();
    expect(reg.has("s1")).toBe(false);
  });
});
