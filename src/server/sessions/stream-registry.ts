/**
 * Process-local registry of the in-flight turn stream for each active session,
 * so a client that reconnects mid-turn — a page refresh, or a second tab — can
 * re-attach to the live response instead of losing it until the turn settles.
 *
 * A turn's SSE frames are captured as they stream (`open` → `StreamSink`),
 * buffered, and fanned out to every reader. A reader that joins late replays the
 * frames buffered so far and then follows live: buffer plus live feed reproduce
 * the exact stream, so the AI SDK rebuilds the assistant message — text and
 * tool-call state alike — just as the first client saw it.
 *
 * An entry lives exactly as long as the turn's stream: opened when capture
 * starts, dropped when it closes. Once a turn has settled there is no entry, so
 * `subscribe` returns `null` and the resume route answers 204 — the settled turn
 * is read back from storage instead. Nothing survives a restart; an interrupted
 * turn is swept to `failed` at startup.
 */
const encoder = new TextEncoder();

/** A captured turn stream: append frames as they arrive, then close it once. */
export interface StreamSink {
  /** Append one frame to the buffer and push it to every current reader. */
  push(chunk: string): void;
  /** End the stream: close every reader and drop the session's entry. */
  close(): void;
}

export interface StreamRegistry {
  /**
   * Start capturing a session's in-flight turn, returning the sink its frames
   * are written to. Call synchronously as the turn's response is built so a
   * near-instant reconnect finds the entry rather than a gap. Replaces any
   * existing entry for the session.
   */
  open(sessionId: string): StreamSink;
  /**
   * A readable of the session's live turn for a reconnecting client — the frames
   * buffered so far followed by live ones — or `null` when no turn is streaming
   * (the resume route maps `null` to a 204).
   */
  subscribe(sessionId: string): ReadableStream<Uint8Array> | null;
  /** Whether a turn is currently streaming for the session. */
  has(sessionId: string): boolean;
}

interface Entry {
  buffer: string[];
  subs: Set<ReadableStreamDefaultController<Uint8Array>>;
}

/**
 * Build a fresh stream registry. State is private to the returned object — kiri
 * creates one where turns run and threads it to the turn and the resume route.
 */
export function createStreamRegistry(): StreamRegistry {
  const entries = new Map<string, Entry>();

  return {
    open(sessionId) {
      const entry: Entry = { buffer: [], subs: new Set() };
      entries.set(sessionId, entry);
      return {
        push(chunk) {
          entry.buffer.push(chunk);
          const bytes = encoder.encode(chunk);
          for (const controller of entry.subs) controller.enqueue(bytes);
        },
        close() {
          for (const controller of entry.subs) controller.close();
          entry.subs.clear();
          // A newer turn may have replaced this entry; only drop our own.
          if (entries.get(sessionId) === entry) entries.delete(sessionId);
        },
      };
    },

    subscribe(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      return new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          // Replay what's buffered, then follow live. `start` runs synchronously,
          // so the snapshot and the subscription register in one tick — no frame
          // slips between them, and none is delivered twice.
          for (const chunk of entry.buffer) c.enqueue(encoder.encode(chunk));
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
