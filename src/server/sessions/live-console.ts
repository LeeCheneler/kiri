import type { UIMessageStreamWriter } from "ai";

/**
 * One live-console snapshot, streamed as a transient `data-tool-console` part
 * with the emitting call's `toolCallId` as the part id. Each snapshot carries
 * the whole tail, so it replaces the previous one client-side and replaying a
 * buffered stream converges on the latest. Transient parts never join the
 * assistant message, so nothing here is persisted — the tool's settled result
 * stays the durable record.
 */
export interface LiveConsoleSnapshot {
  /** The merged output so far, capped to its tail. */
  text: string;
  /** Whether output ahead of the tail was dropped by the cap. */
  truncated: boolean;
}

/** A running tool call's live output feed; `end` flushes and stops it. */
export interface LiveConsoleEmitter {
  /** Add a chunk of output to the next coalesced snapshot. */
  append(chunk: string): void;
  /** Flush anything pending and stop emitting. Call once, when the work settles. */
  end(): void;
}

/** Tunable cadence and ceiling, defaulting to the module constants. Tests pass tiny values. */
export interface LiveConsoleOptions {
  flushMs?: number;
  tailChars?: number;
}

// Cadence and ceiling for the live console: snapshots go out at most once per
// interval and carry only the output's tail, so a firehose command can't
// flood the stream or grow frames without bound. The cap matches the settled
// result's per-stream cap — the live view never shows less than the result
// will keep.
const FLUSH_MS = 300;
const TAIL_CHARS = 16 * 1024;

/**
 * Batch a tool call's output into coalesced live-console snapshots on
 * `writer`. Appends accumulate a tail-capped merge and are flushed on a
 * trailing timer, so however fast output arrives the stream sees at most one
 * snapshot per interval. The shared throttle for any tool that streams
 * progress — build on this rather than writing per-chunk parts.
 */
export function liveConsoleEmitter(
  writer: UIMessageStreamWriter,
  toolCallId: string,
  options: LiveConsoleOptions = {},
): LiveConsoleEmitter {
  const { flushMs = FLUSH_MS, tailChars = TAIL_CHARS } = options;
  let text = "";
  let truncated = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    dirty = false;
    const data: LiveConsoleSnapshot = { text, truncated };
    writer.write({ type: "data-tool-console", id: toolCallId, data, transient: true });
  };

  return {
    append(chunk) {
      text += chunk;
      if (text.length > tailChars) {
        let start = text.length - tailChars;
        // Never start on a low surrogate — step past a pair the cap split.
        const lead = text.charCodeAt(start);
        if (lead >= 0xdc00 && lead <= 0xdfff) start += 1;
        text = text.slice(start);
        truncated = true;
      }
      dirty = true;
      timer ??= setTimeout(() => {
        timer = undefined;
        flush();
      }, flushMs);
    },
    end() {
      clearTimeout(timer);
      timer = undefined;
      if (dirty) flush();
    },
  };
}
