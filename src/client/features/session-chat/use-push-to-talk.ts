import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../../api.ts";
import { useModels } from "../../state/sessions.ts";
import { microphonePreference, setMicrophonePreference } from "./microphone-preference.ts";
import {
  type AudioInput,
  type Microphone,
  type Recorder,
  type Recording,
  defaultRecorder,
} from "./recorder.ts";

/** Where push-to-talk is: waiting, opening the microphone, capturing, or turning the capture into text. */
export type PushToTalkStatus = "idle" | "starting" | "recording" | "transcribing";

/** What push-to-talk exposes to its controls. */
export interface PushToTalkState {
  /** The action is on offer: a transcription model is configured and the browser can record. */
  available: boolean;
  status: PushToTalkStatus;
  /** The last attempt failed or captured nothing; cleared by the next. */
  error: string | undefined;
  /** Begin a hold: opens the microphone and records; a no-op when unavailable or not idle. */
  start: () => void;
  /** End the hold: transcribes the capture into the draft; a no-op outside a hold. */
  stop: () => void;
  /** The audio inputs the browser offers, once a hold has opened the microphone or a listing was asked for. */
  inputs: AudioInput[];
  /** The chosen input's device id; undefined for the browser's default. */
  deviceId: string | undefined;
  /** The chosen input's name, for display. */
  deviceLabel: string;
  /** Choose an input (undefined for the browser's default): persisted, and opened by the next hold. */
  setDevice: (deviceId: string | undefined) => void;
  /** Re-list the inputs, for a device plugged in since. */
  refreshInputs: () => void;
}

// A capture shorter than this holds no speech — a hold released as the
// microphone came live, or a slip — and would only earn a provider error.
const DEFAULT_MIN_CAPTURE_MS = 250;

/** What the control shows for a hold that produced nothing to transcribe. */
export const NOTHING_CAPTURED = "Nothing captured — hold until it reads listening…, then speak.";

/** The display name of the browser's default input. */
export const DEFAULT_INPUT_LABEL = "Browser default";

// Spoken text joins the draft as another sentence would: after a space,
// unless the draft is empty or already ends in whitespace.
const appendSpoken = (draft: string, spoken: string): string =>
  draft === "" || /\s$/.test(draft) ? `${draft}${spoken}` : `${draft} ${spoken}`;

// One hold's microphone and the recording running on it.
interface Hold {
  mic: Microphone;
  active: Recording;
  since: number;
}

/**
 * The composer's push-to-talk over a controlled draft. The microphone is
 * held only for the hold: `start` opens the chosen input (the browser may
 * show its permission prompt then) and records until `stop`, which gives
 * the microphone back as soon as the capture is in hand — so the browser's
 * recording indicator lights for the hold and no longer — then sends the
 * capture to be transcribed (and tidied, server-side) and appends the text
 * to `value` via `onChange`. Appends rather than replaces — dictation adds
 * to what's typed, and a draft edited while transcription is in flight
 * keeps that edit. A hold released before the microphone came live, or too
 * short to hold speech, sends nothing and says so. The input choice
 * persists across pages and reloads. Unavailable (and inert) until the
 * models listing reports a transcription model and the recorder can
 * capture.
 */
export function usePushToTalk(opts: {
  value: string;
  onChange: (value: string) => void;
  recorder?: Recorder;
  minCaptureMs?: number;
}): PushToTalkState {
  const {
    value,
    onChange,
    recorder = defaultRecorder,
    minCaptureMs = DEFAULT_MIN_CAPTURE_MS,
  } = opts;
  const available = useModels().data?.transcription !== undefined && recorder.supported();
  const [status, setStatus] = useState<PushToTalkStatus>("idle");
  const [error, setError] = useState<string>();
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [deviceId, setDeviceId] = useState(microphonePreference);
  // The live draft, read when the text lands so it appends to what's there.
  const latest = useRef(value);
  latest.current = value;
  // Whether the hold is still down, and its microphone once that is live.
  const holding = useRef(false);
  const hold = useRef<Hold | null>(null);
  // Set on leaving, so a microphone that comes live afterwards is let go.
  const left = useRef(false);

  const refreshInputs = useCallback(() => {
    void recorder.listInputs().then(setInputs, () => undefined);
  }, [recorder]);

  // A remembered input is named by the listing, so ask for it on arrival.
  // Access was granted when the input was chosen, so this prompts for
  // nothing; with no choice remembered, the first hold's open lists them.
  useEffect(() => {
    if (available && deviceId !== undefined) refreshInputs();
  }, [available, deviceId, refreshInputs]);

  // Release everything on leaving: an in-flight capture and its microphone.
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
      holding.current = false;
      const current = hold.current;
      hold.current = null;
      if (current) {
        void current.active.stop();
        current.mic.close();
      }
    };
  }, []);

  const finish = useCallback(
    async ({ mic, active, since }: Hold) => {
      setStatus("transcribing");
      try {
        // The microphone goes back as soon as the capture is in hand — not
        // after the transcription, which takes a while longer.
        const audio = await active.stop().finally(() => mic.close());
        if (Date.now() - since < minCaptureMs || audio.size === 0) {
          setError(NOTHING_CAPTURED);
          return;
        }
        const spoken = await transcribeAudio(audio);
        if (spoken !== "") onChange(appendSpoken(latest.current, spoken));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "transcription failed");
      } finally {
        setStatus("idle");
      }
    },
    [onChange, minCaptureMs],
  );

  const start = useCallback(() => {
    if (!available || status !== "idle" || holding.current) return;
    holding.current = true;
    setError(undefined);
    setStatus("starting");
    recorder.open(deviceId).then(
      (mic) => {
        if (left.current) {
          mic.close();
          return;
        }
        // Labels are withheld until access is granted, which it now is.
        refreshInputs();
        if (!holding.current) {
          // Released while the microphone was still coming live: nothing
          // was captured, and the microphone isn't wanted after all.
          mic.close();
          setStatus("idle");
          setError(NOTHING_CAPTURED);
          return;
        }
        hold.current = { mic, active: mic.record(), since: Date.now() };
        setStatus("recording");
      },
      (cause: unknown) => {
        holding.current = false;
        setStatus("idle");
        setError(cause instanceof Error ? cause.message : "microphone unavailable");
      },
    );
  }, [available, status, recorder, deviceId, refreshInputs]);

  const stop = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const current = hold.current;
    hold.current = null;
    // Still starting: the open's own handling sees the hold has ended.
    if (current) void finish(current);
  }, [finish]);

  const setDevice = useCallback((next: string | undefined) => {
    setMicrophonePreference(next);
    setDeviceId(next);
  }, []);

  const deviceLabel =
    (deviceId === undefined ? undefined : inputs.find((input) => input.id === deviceId)?.label) ??
    DEFAULT_INPUT_LABEL;

  return {
    available,
    status,
    error,
    start,
    stop,
    inputs,
    deviceId,
    deviceLabel,
    setDevice,
    refreshInputs,
  };
}
