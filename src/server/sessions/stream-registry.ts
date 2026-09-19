import type { UIMessageChunk } from "ai";

/**
 * Process-local registry of the in-flight turn stream for each active session,
 * so a client that reconnects mid-turn — a page refresh, or a second tab — can
 * re-attach to the live response instead of losing it until the turn settles.
 *
 * A turn's chunks are captured as they stream (`open` → `StreamSink`), encoded
 * once as SSE frames, buffered, and fanned out to every reader. A reader that
 * joins late replays the frames buffered so far and then follows live.
 *
 * The buffer holds only what the saved transcript does not. Each time the turn
 * saves a finished step it marks a checkpoint: the frames up to it are dropped
 * and the entry's base moves to the revision that save committed. A reader
 * names the transcript revision it holds, and is replayed into only when that
 * is the entry's base — the saved transcript plus the buffer then rebuild the
 * assistant message, text and tool-call state alike, exactly as the first
 * client saw it. Any other revision would duplicate or skip a step, so that
 * reader is handed a stream that ends at once and reads the transcript again.
 *
 * Transient chunks are progress, not content: each one supersedes the last of
 * its type and id (a running command's console carries its whole tail every
 * time), so the buffer keeps only the latest and a long-running call retains
 * one snapshot rather than every one it ever sent.
 *
 * An entry lives exactly as long as the turn's stream: opened when capture
 * starts, dropped when it closes. Once a turn has settled there is no entry, so
 * `subscribe` returns `null` and the resume route answers 204 — the settled turn
 * is read back from storage instead. Nothing survives a restart; an interrupted
 * turn is swept to `failed` at startup.
 */
const encoder = new TextEncoder();

/** A captured turn stream: append chunks as they arrive, then close it once. */
export interface StreamSink {
  /** Buffer one chunk as an SSE frame and push it to every current reader. */
  push(chunk: UIMessageChunk): void;
  /**
   * Everything pushed so far is saved in the transcript at `transcriptRevision`:
   * drop it from the buffer and replay from that revision on. Call between the
   * chunk that ends a saved step and the next one.
   */
  checkpoint(transcriptRevision: number): void;
  /** End the stream: close every reader and drop the session's entry. */
  close(): void;
}

export interface StreamRegistry {
  /**
   * Start capturing a session's in-flight turn, returning the sink its chunks
   * are written to. `transcriptRevision` is the saved transcript the stream
   * continues from. Call synchronously as the turn's response is built so a
   * near-instant reconnect finds the entry rather than a gap. Replaces any
   * existing entry for the session.
   */
  open(sessionId: string, transcriptRevision: number): StreamSink;
  /**
   * A readable of the session's live turn for a client holding the transcript
   * at `transcriptRevision` — the frames buffered since that revision followed
   * by live ones, or an already-ended stream when the buffer continues from a
   * different revision. `null` when no turn is streaming (the resume route maps
   * it to a 204).
   */
  subscribe(sessionId: string, transcriptRevision: number): ReadableStream<Uint8Array> | null;
  /** Whether a turn is currently streaming for the session. */
  has(sessionId: string): boolean;
}

interface Frame {
  bytes: Uint8Array;
}

interface Entry {
  /** The transcript revision the buffer continues from. */
  baseRevision: number;
  /** The stream's opening `start` frame, replayed ahead of whatever the buffer holds. */
  start: Frame | undefined;
  buffer: Frame[];
  /** The buffered frame of each transient chunk, by `transientKey`. */
  transients: Map<string, Frame>;
  subs: Set<ReadableStreamDefaultController<Uint8Array>>;
}

// The SDK's SSE framing for a UI message stream.
const encodeFrame = (chunk: UIMessageChunk): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);

// What a transient chunk supersedes: the earlier chunk of its type and id.
const transientKey = (chunk: UIMessageChunk): string | null =>
  "transient" in chunk && chunk.transient === true ? `${chunk.type}:${chunk.id ?? ""}` : null;

const endedStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

/**
 * Build a fresh stream registry. State is private to the returned object — kiri
 * creates one where turns run and threads it to the turn and the resume route.
 */
export function createStreamRegistry(): StreamRegistry {
  const entries = new Map<string, Entry>();

  return {
    open(sessionId, transcriptRevision) {
      const entry: Entry = {
        baseRevision: transcriptRevision,
        start: undefined,
        buffer: [],
        transients: new Map(),
        subs: new Set(),
      };
      entries.set(sessionId, entry);
      return {
        push(chunk) {
          const frame: Frame = { bytes: encodeFrame(chunk) };
          if (chunk.type === "start") {
            entry.start = frame;
          } else {
            const key = transientKey(chunk);
            if (key !== null) {
              const superseded = entry.transients.get(key);
              if (superseded) entry.buffer.splice(entry.buffer.indexOf(superseded), 1);
              entry.transients.set(key, frame);
            }
            entry.buffer.push(frame);
          }
          for (const controller of entry.subs) controller.enqueue(frame.bytes);
        },
        checkpoint(revision) {
          entry.baseRevision = revision;
          entry.buffer = [];
          entry.transients.clear();
        },
        close() {
          for (const controller of entry.subs) controller.close();
          entry.subs.clear();
          // A newer turn may have replaced this entry; only drop our own.
          if (entries.get(sessionId) === entry) entries.delete(sessionId);
        },
      };
    },

    subscribe(sessionId, transcriptRevision) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      if (entry.baseRevision !== transcriptRevision) return endedStream();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      return new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          // Replay what's buffered, then follow live. `start` runs synchronously,
          // so the replay and the subscription register in one tick — no frame
          // slips between them, and none is delivered twice.
          if (entry.start) c.enqueue(entry.start.bytes);
          for (const frame of entry.buffer) c.enqueue(frame.bytes);
          entry.subs.add(c);
        },
        cancel() {
          entry.subs.delete(controller);
        },
      });
    },

    has(sessionId) {
      return entries.has(sessionId);
    },
  };
}
