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
 * Both sides of the fan-out are bounded in bytes. A step whose unsaved frames
 * outgrow the replay limit stops being replayable: the buffer is dropped, and
 * a reader arriving before the step is saved is held — sent nothing — until
 * it is, then ended so it reads the transcript that now contains the step.
 * Nothing durable is lost that way; trimming frames out of the middle of a
 * step would be. A reader whose queue outgrows its own limit has stopped
 * keeping up: it is ended too, and rejoins from the saved transcript.
 *
 * Every reader is one of these, the client that started the turn included
 * (`StreamSink.reader`), so there is one bounded path out of a turn.
 *
 * An entry is listed exactly as long as the turn runs: opened when capture
 * starts, dropped when the turn settles (`close`). Once a turn has settled
 * there is no entry, so `subscribe` returns `null` and the resume route answers
 * 204 — the settled turn is read back from storage instead. Readers already
 * attached are a separate matter: a turn settles inside its stream's last
 * moments, with its closing frames still to come, so they stay attached until
 * the stream itself is exhausted (`end`). Nothing survives a restart; an
 * interrupted turn is swept to `failed` at startup.
 */
const encoder = new TextEncoder();

/** The most unsaved frames an entry keeps for replay: room for a step carrying a few generated images. */
export const REPLAY_LIMIT_BYTES = 16 * 1024 * 1024;

/** The most a reader may leave unread. Above the replay limit, so a full replay never ends the reader it was for. */
export const READER_LIMIT_BYTES = 32 * 1024 * 1024;

/** Byte ceilings, defaulting to the module constants. Tests pass tiny values. */
export interface StreamRegistryOptions {
  replayLimitBytes?: number;
  readerLimitBytes?: number;
}

/** A captured turn stream: append chunks as they arrive, close it as the turn settles, end it when the stream runs out. */
export interface StreamSink {
  /** A reader from the stream's first frame, for the client that started the turn. */
  reader(): ReadableStream<Uint8Array>;
  /** Buffer one chunk as an SSE frame and push it to every current reader. */
  push(chunk: UIMessageChunk): void;
  /**
   * Everything pushed so far is saved in the transcript at `transcriptRevision`:
   * drop it from the buffer and replay from that revision on. Call between the
   * chunk that ends a saved step and the next one.
   */
  checkpoint(transcriptRevision: number): void;
  /** The turn has settled: drop the session's entry, so no reader joins from here on. */
  close(): void;
  /** The stream is exhausted: end every reader still attached. Implies `close`. */
  end(): void;
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
   * by live ones. When the buffer continues from a different revision the
   * stream has already ended; when the step in progress outgrew the replay
   * limit it stays silent and ends once that step is saved. `null` when no turn
   * is streaming (the resume route maps it to a 204).
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
  /** Bytes held in `buffer`. */
  bufferedBytes: number;
  /** False once the step in progress outgrew the replay limit, until its save. */
  replayable: boolean;
  /** The buffered frame of each transient chunk, by `transientKey`. */
  transients: Map<string, Frame>;
  subs: Set<ReadableStreamDefaultController<Uint8Array>>;
  /** Readers that arrived while the entry was not replayable, waiting on the next save. */
  held: Set<ReadableStreamDefaultController<Uint8Array>>;
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
export function createStreamRegistry(options: StreamRegistryOptions = {}): StreamRegistry {
  const { replayLimitBytes = REPLAY_LIMIT_BYTES, readerLimitBytes = READER_LIMIT_BYTES } = options;
  const entries = new Map<string, Entry>();
  const readerQueue = new ByteLengthQueuingStrategy({ highWaterMark: readerLimitBytes });

  const clearBuffer = (entry: Entry): void => {
    entry.buffer = [];
    entry.bufferedBytes = 0;
    entry.transients.clear();
  };

  const buffer = (entry: Entry, chunk: UIMessageChunk, frame: Frame): void => {
    const key = transientKey(chunk);
    if (key !== null) {
      const superseded = entry.transients.get(key);
      if (superseded) {
        entry.buffer.splice(entry.buffer.indexOf(superseded), 1);
        entry.bufferedBytes -= superseded.bytes.byteLength;
      }
      entry.transients.set(key, frame);
    }
    entry.buffer.push(frame);
    entry.bufferedBytes += frame.bytes.byteLength;
    if (entry.bufferedBytes <= replayLimitBytes) return;
    entry.replayable = false;
    clearBuffer(entry);
  };

  const endAll = (readers: Set<ReadableStreamDefaultController<Uint8Array>>): void => {
    for (const controller of readers) controller.close();
    readers.clear();
  };

  const attach = (entry: Entry): ReadableStream<Uint8Array> => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    return new ReadableStream<Uint8Array>(
      {
        start(c) {
          controller = c;
          if (!entry.replayable) {
            entry.held.add(c);
            return;
          }
          // Replay what's buffered, then follow live. `start` runs synchronously,
          // so the replay and the subscription register in one tick — no frame
          // slips between them, and none is delivered twice.
          if (entry.start) c.enqueue(entry.start.bytes);
          for (const frame of entry.buffer) c.enqueue(frame.bytes);
          entry.subs.add(c);
        },
        cancel() {
          entry.subs.delete(controller);
          entry.held.delete(controller);
        },
      },
      readerQueue,
    );
  };

  return {
    open(sessionId, transcriptRevision) {
      const entry: Entry = {
        baseRevision: transcriptRevision,
        start: undefined,
        buffer: [],
        bufferedBytes: 0,
        replayable: true,
        transients: new Map(),
        subs: new Set(),
        held: new Set(),
      };
      entries.set(sessionId, entry);
      const close = (): void => {
        // A newer turn may have replaced this entry; only drop our own.
        if (entries.get(sessionId) === entry) entries.delete(sessionId);
      };
      return {
        reader: () => attach(entry),
        push(chunk) {
          const frame: Frame = { bytes: encodeFrame(chunk) };
          if (chunk.type === "start") entry.start = frame;
          else if (entry.replayable) buffer(entry, chunk, frame);
          for (const controller of entry.subs) {
            controller.enqueue(frame.bytes);
            if ((controller.desiredSize ?? 0) > 0) continue;
            // The reader has the limit's worth unread: end it behind what is
            // queued, and let it rejoin from the saved transcript.
            controller.close();
            entry.subs.delete(controller);
          }
        },
        checkpoint(revision) {
          entry.baseRevision = revision;
          entry.replayable = true;
          clearBuffer(entry);
          endAll(entry.held);
        },
        close,
        end() {
          close();
          endAll(entry.subs);
          endAll(entry.held);
        },
      };
    },

    subscribe(sessionId, transcriptRevision) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      if (entry.baseRevision !== transcriptRevision) return endedStream();
      return attach(entry);
    },

    has(sessionId) {
      return entries.has(sessionId);
    },
  };
}
