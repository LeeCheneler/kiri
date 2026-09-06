import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../../api.ts";
import { useModels } from "../../state/sessions.ts";
import { type Recorder, type Recording, defaultRecorder } from "./recorder.ts";

/** Where push-to-talk is: waiting, capturing, or turning the capture into text. */
export type PushToTalkStatus = "idle" | "recording" | "transcribing";

/** What push-to-talk exposes to its control. */
export interface PushToTalkState {
  /** The action is on offer: a transcription model is configured and the browser can record. */
  available: boolean;
  status: PushToTalkStatus;
  /** The last attempt failed; cleared by the next. */
  error: string | undefined;
  /** Begin recording (`recording` once the microphone is live); a no-op when unavailable or not idle. */
  start: () => void;
  /** End recording and transcribe into the draft; a no-op when not recording. */
  stop: () => void;
}

// Spoken text joins the draft as another sentence would: after a space,
// unless the draft is empty or already ends in whitespace.
const appendSpoken = (draft: string, spoken: string): string =>
  draft === "" || /\s$/.test(draft) ? `${draft}${spoken}` : `${draft} ${spoken}`;

/**
 * The composer's push-to-talk over a controlled draft: `start` records the
 * microphone until `stop`, then sends the capture to be transcribed (and
 * tidied, server-side) and appends the text to `value` via `onChange`.
 * Appends rather than replaces — dictation adds to what's typed, and a draft
 * edited while transcription is in flight keeps that edit. Unavailable (and
 * inert) until the models listing reports a transcription model and the
 * recorder can capture.
 */
export function usePushToTalk(opts: {
  value: string;
  onChange: (value: string) => void;
  recorder?: Recorder;
}): PushToTalkState {
  const { value, onChange, recorder = defaultRecorder } = opts;
  const available = useModels().data?.transcription !== undefined && recorder.supported();
  const [status, setStatus] = useState<PushToTalkStatus>("idle");
  const [error, setError] = useState<string>();
  // The live draft, read when the text lands so it appends to what's there.
  const latest = useRef(value);
  latest.current = value;
  // Whether the hold is still down, and the recording once the recorder has
  // one. A release that lands before the microphone is ready — the browser's
  // permission prompt on first use takes the pointer with it — means nothing
  // was captured, so the recording is dropped rather than sent.
  const holding = useRef(false);
  const recording = useRef<Recording | null>(null);

  const finish = useCallback(
    async (active: Recording) => {
      setStatus("transcribing");
      try {
        const audio = await active.stop();
        // A hold released before anything was captured has nothing to send.
        if (audio.size > 0) {
          const spoken = await transcribeAudio(audio);
          if (spoken !== "") onChange(appendSpoken(latest.current, spoken));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "transcription failed");
      } finally {
        setStatus("idle");
      }
    },
    [onChange],
  );

  const start = useCallback(() => {
    if (!available || status !== "idle" || holding.current) return;
    holding.current = true;
    setError(undefined);
    recorder.start().then(
      (active) => {
        if (!holding.current) {
          void active.stop();
          return;
        }
        recording.current = active;
        setStatus("recording");
      },
      (cause: unknown) => {
        holding.current = false;
        setError(cause instanceof Error ? cause.message : "microphone unavailable");
      },
    );
  }, [available, status, recorder]);

  const stop = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const active = recording.current;
    recording.current = null;
    if (active) void finish(active);
  }, [finish]);

  // Leaving the page mid-hold releases the microphone rather than leaving it
  // live; the capture is dropped, as there is no draft to land in.
  useEffect(
    () => () => {
      holding.current = false;
      void recording.current?.stop();
      recording.current = null;
    },
    [],
  );

  return { available, status, error, start, stop };
}
