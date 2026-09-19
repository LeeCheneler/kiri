import { describe, expect, it } from "bun:test";
import type { UIMessageChunk } from "ai";

import type { Message } from "./store.ts";
import { createStreamRegistry } from "./stream-registry.ts";

const decoder = new TextDecoder();

const text = (delta: string): UIMessageChunk => ({ type: "text-delta", id: "t1", delta });

const consoleSnapshot = (toolCallId: string, tail: string): UIMessageChunk => ({
  type: "data-tool-console",
  id: toolCallId,
  data: { text: tail, truncated: false },
  transient: true,
});

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
  it("retains an approval continuation's original parts while checkpoints change its message", () => {
    const baseline: [Message] = [
      {
        id: "a1",
        sessionId: "s1",
        index: 1,
        role: "assistant",
        contextTokens: 10,
        createdAt: new Date(),
        parts: [
          {
            type: "tool-echo",
            toolCallId: "c1",
            state: "approval-responded",
            input: { value: "hi" },
            approval: { id: "approval-1", approved: true },
          },
        ],
      },
    ];
    const reg = createStreamRegistry();
    expect(reg.snapshotBeforeTurn("s1")).toBeNull();
    const sink = reg.open("s1", baseline, 7);
    expect(reg.snapshotBeforeTurn("s1")?.transcriptRevision).toBe(7);
    baseline[0].parts = [
      {
        type: "tool-echo",
        toolCallId: "c1",
        state: "output-available",
        input: { value: "hi" },
        output: "hi",
      },
    ];
    expect(reg.snapshotBeforeTurn("s1")?.messages[0]?.parts).toContainEqual(
      expect.objectContaining({
        state: "approval-responded",
        approval: { id: "approval-1", approved: true },
      }),
    );
    sink.close();
    expect(reg.snapshotBeforeTurn("s1")).toBeNull();
  });

  it("has reflects a session's stream from open through close", () => {
    const reg = createStreamRegistry();
    expect(reg.has("s1")).toBe(false);
    const sink = reg.open("s1");
    expect(reg.has("s1")).toBe(true);
    sink.close();
    expect(reg.has("s1")).toBe(false);
  });

  it("subscribe on a session with no live turn returns null", () => {
    expect(createStreamRegistry().subscribe("ghost")).toBeNull();
  });

  it("a subscriber that joins before any frame receives them live", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    const out = frames(reg.subscribe("s1"));
    sink.push(text("a"));
    expect(await out.next()).toBe(frame(text("a")));
    sink.push(text("b"));
    expect(await out.next()).toBe(frame(text("b")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("a subscriber that joins late replays the buffer then follows live, in order", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    sink.push(text("a"));
    sink.push(text("b"));
    const out = frames(reg.subscribe("s1"));
    expect(await out.next()).toBe(frame(text("a")));
    expect(await out.next()).toBe(frame(text("b")));
    sink.push(text("c"));
    expect(await out.next()).toBe(frame(text("c")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("replays only the latest transient chunk of each type and id", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    sink.push(text("a"));
    sink.push(consoleSnapshot("c1", "one"));
    sink.push(consoleSnapshot("c2", "other call"));
    sink.push(text("b"));
    sink.push(consoleSnapshot("c1", "one two"));
    const out = frames(reg.subscribe("s1"));
    expect(await out.next()).toBe(frame(text("a")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c2", "other call")));
    expect(await out.next()).toBe(frame(text("b")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one two")));
    sink.close();
    expect(await out.next()).toBeUndefined();
  });

  it("still sends every transient chunk to a reader already following live", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    const out = frames(reg.subscribe("s1"));
    sink.push(consoleSnapshot("c1", "one"));
    sink.push(consoleSnapshot("c1", "one two"));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one")));
    expect(await out.next()).toBe(frame(consoleSnapshot("c1", "one two")));
    sink.close();
  });

  it("fans out the same frames to multiple subscribers", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    sink.push(text("a"));
    const one = frames(reg.subscribe("s1"));
    const two = frames(reg.subscribe("s1"));
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
    const sink = reg.open("s1");
    sink.push(text("a"));
    sink.close();
    expect(reg.subscribe("s1")).toBeNull();
    expect(reg.has("s1")).toBe(false);
  });

  it("close with no subscribers still drops the entry", () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    sink.push(text("a")); // buffered, never read
    sink.close();
    expect(reg.has("s1")).toBe(false);
  });

  it("a cancelled subscriber is pruned without disturbing the others", async () => {
    const reg = createStreamRegistry();
    const sink = reg.open("s1");
    const gone = frames(reg.subscribe("s1"));
    const kept = frames(reg.subscribe("s1"));
    await gone.cancel();
    sink.push(text("a")); // must reach `kept` and not throw on the pruned controller
    expect(await kept.next()).toBe(frame(text("a")));
    sink.close();
    expect(await kept.next()).toBeUndefined();
  });

  it("re-opening a session keeps the newer stream when the old one closes", () => {
    const reg = createStreamRegistry();
    const first = reg.open("s1");
    const second = reg.open("s1");
    first.close(); // must not drop the entry the second open installed
    expect(reg.has("s1")).toBe(true);
    second.close();
    expect(reg.has("s1")).toBe(false);
  });
});
