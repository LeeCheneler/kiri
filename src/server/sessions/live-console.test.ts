import { describe, expect, it } from "bun:test";
import type { UIMessageChunk, UIMessageStreamWriter } from "ai";
import { liveConsoleEmitter } from "./live-console.ts";

// A writer that records every chunk written; merge/onError are never used by
// the emitter.
const recordingWriter = (chunks: UIMessageChunk[]): UIMessageStreamWriter => ({
  write: (chunk) => {
    chunks.push(chunk);
  },
  merge: () => {
    throw new Error("not used");
  },
  onError: undefined,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("liveConsoleEmitter", () => {
  it("coalesces appends into one snapshot per interval, keyed to the tool call", async () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", { flushMs: 10 });

    emitter.append("one\n");
    emitter.append("two\n");
    // Nothing goes out synchronously — the first flush waits for the timer.
    expect(chunks).toHaveLength(0);
    await sleep(25);

    expect(chunks).toEqual([
      {
        type: "data-tool-console",
        id: "call-1",
        data: { text: "one\ntwo\n", truncated: false },
        transient: true,
      },
    ]);
  });

  it("emits nothing further while no new output lands", async () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", { flushMs: 5 });

    emitter.append("only\n");
    await sleep(30);

    // One flush for the one append; the timer does not keep ticking idle.
    expect(chunks).toHaveLength(1);
  });

  it("snapshots grow across intervals, each carrying the whole merge", async () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", { flushMs: 5 });

    emitter.append("first");
    await sleep(20);
    emitter.append(" second");
    await sleep(20);

    expect(chunks.map((chunk) => (chunk as { data: { text: string } }).data.text)).toEqual([
      "first",
      "first second",
    ]);
  });

  it("keeps only the tail past the cap and flags the cut", async () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", {
      flushMs: 5,
      tailChars: 8,
    });

    emitter.append("0123456789");
    await sleep(20);

    expect(chunks).toEqual([
      {
        type: "data-tool-console",
        id: "call-1",
        data: { text: "23456789", truncated: true },
        transient: true,
      },
    ]);
  });

  it("drops an orphaned low surrogate when the cap splits a pair", async () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", {
      flushMs: 5,
      tailChars: 3,
    });

    // "ab💥cd" is six UTF-16 units; a 3-unit tail would start on 💥's low half.
    emitter.append("ab💥cd");
    await sleep(20);

    const data = (chunks[0] as { data: { text: string } }).data;
    expect(data.text).toBe("cd");
  });

  it("end flushes pending output immediately and stops the timer", () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", { flushMs: 60_000 });

    emitter.append("tail\n");
    emitter.end();

    // The pending snapshot went out without waiting for the (long) timer.
    expect(chunks).toEqual([
      {
        type: "data-tool-console",
        id: "call-1",
        data: { text: "tail\n", truncated: false },
        transient: true,
      },
    ]);
  });

  it("end with nothing pending writes nothing", () => {
    const chunks: UIMessageChunk[] = [];
    const emitter = liveConsoleEmitter(recordingWriter(chunks), "call-1", { flushMs: 5 });

    emitter.end();

    expect(chunks).toHaveLength(0);
  });
});
