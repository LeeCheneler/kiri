import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../../api.ts";
import { useModels } from "../../state/sessions.ts";
import { type Microphone, type Recorder, type Recording, defaultRecorder } from "./recorder.ts";

/** Where push-to-talk is: waiting, opening the microphone, capturing, or turning the capture into text. */
export type PushToTalkStatus = "idle" | "starting" | "recording" | "transcribing";

/** What push-to-talk exposes to its control. */
export interface PushToTalkState {
  /** The action is on offer: a transcription model is configured and the browser can record. */
  available: boolean;
  status: PushToTalkStatus;
  /** The last attempt failed or captured nothing; cleared by the next. */
  error: string | undefined;
  /** Begin a hold: opens the microphone if need be, then records; a no-op when unavailable or not idle. */
  start: () => void;
  /** End the hold: transcribes the capture into the draft; a no-op outside a hold. */
  stop: () => void;
}

// How long an opened microphone stays open after a hold's text has landed,
// so the next hold records at once rather than waiting on device start-up.
const DEFAULT_WARM_MS = 60_000;

// A capture shorter than this holds no speech — a hold released as the
// microphone came live, or a slip — and would only earn a provider error.
const DEFAULT_MIN_CAPTURE_MS = 250;

/** What the control shows for a hold that produced nothing to transcribe. */
export const NOTHING_CAPTURED = "Nothing captured — hold until it reads listening…, then speak.";

// Spoken text joins the draft as another sentence would: after a space,
// unless the draft is empty or already ends in whitespace.
const appendSpoken = (draft: string, spoken: string): string =>
  draft === "" || /\s$/.test(draft) ? `${draft}${spoken}` : `${draft} ${spoken}`;

/**
 * The composer's push-to-talk over a controlled draft: `start` opens the
 * microphone (kept warm between holds) and records until `stop`, then sends
 * the capture to be transcribed (and tidied, server-side) and appends the
 * text to `value` via `onChange`. Appends rather than replaces — dictation
 * adds to what's typed, and a draft edited while transcription is in flight
 * keeps that edit. A hold released before the microphone came live, or too
 * short to hold speech, sends nothing and says so. Unavailable (and inert)
 * until the models listing reports a transcription model and the recorder
 * can capture.
 */
export function usePushToTalk(opts: {
  value: string;
  onChange: (value: string) => void;
  recorder?: Recorder;
  warmMs?: number;
  minCaptureMs?: number;
}): PushToTalkState {
  const {
    value,
    onChange,
    recorder = defaultRecorder,
    warmMs = DEFAULT_WARM_MS,
    minCaptureMs = DEFAULT_MIN_CAPTURE_MS,
  } = opts;
  const available = useModels().data?.transcription !== undefined && recorder.supported();
  const [status, setStatus] = useState<PushToTalkStatus>("idle");
  const [error, setError] = useState<string>();
  // The live draft, read when the text lands so it appends to what's there.
  const latest = useRef(value);
  latest.current = value;
  // The open microphone and the timer that closes it once it has sat unused.
  const mic = useRef<Microphone | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the hold is still down, and the recording once one is running.
  const holding = useRef(false);
  const recording = useRef<{ active: Recording; since: number } | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const keepWarm = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      mic.current?.close();
      mic.current = null;
    }, warmMs);
  }, [cancelClose, warmMs]);

  const finish = useCallback(
    async (active: Recording, since: number) => {
      setStatus("transcribing");
      try {
        const audio = await active.stop();
        if (Date.now() - since < minCaptureMs || audio.size === 0) {
          setError(NOTHING_CAPTURED);
          return;
        }
        const spoken = await transcribeAudio(audio);
        if (spoken !== "") onChange(appendSpoken(latest.current, spoken));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "transcription failed");
      } finally {
        keepWarm();
        setStatus("idle");
      }
    },
    [onChange, keepWarm, minCaptureMs],
  );

  const begin = useCallback((open: Microphone) => {
    recording.current = { active: open.record(), since: Date.now() };
    setStatus("recording");
  }, []);

  const start = useCallback(() => {
    if (!available || status !== "idle" || holding.current) return;
    holding.current = true;
    setError(undefined);
    cancelClose();
    if (mic.current) {
      begin(mic.current);
      return;
    }
    setStatus("starting");
    recorder.open().then(
      (open) => {
        mic.current = open;
        if (holding.current) {
          begin(open);
          return;
        }
        // Released while the microphone was still coming live: nothing was
        // captured, but it stays warm so the next hold records at once.
        keepWarm();
        setStatus("idle");
        setError(NOTHING_CAPTURED);
      },
      (cause: unknown) => {
        holding.current = false;
        setStatus("idle");
        setError(cause instanceof Error ? cause.message : "microphone unavailable");
      },
    );
  }, [available, status, recorder, begin, keepWarm, cancelClose]);

  const stop = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const current = recording.current;
    recording.current = null;
    if (current) void finish(current.active, current.since);
  }, [finish]);

  // Leaving the page releases the microphone; a capture in progress is
  // dropped, as there is no draft to land in.
  useEffect(
    () => () => {
      holding.current = false;
      cancelClose();
      void recording.current?.active.stop();
      recording.current = null;
      mic.current?.close();
      mic.current = null;
    },
    [cancelClose],
  );

  return { available, status, error, start, stop };
}
