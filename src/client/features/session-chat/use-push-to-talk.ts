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
  /** Begin a hold: records at once on the open microphone; a no-op when unavailable or not idle. */
  start: () => void;
  /** End the hold: transcribes the capture into the draft; a no-op outside a hold. */
  stop: () => void;
  /** The audio inputs the browser offers, once the microphone has been opened. */
  inputs: AudioInput[];
  /** The chosen input's device id; undefined for the browser's default. */
  deviceId: string | undefined;
  /** The chosen input's name, for display. */
  deviceLabel: string;
  /** Choose an input (undefined for the browser's default): persisted, and opened in place of the current one. */
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

/**
 * The composer's push-to-talk over a controlled draft. While available, the
 * chosen microphone is opened on arrival and held until the page is left,
 * so a hold records at once rather than waiting on device start-up; `start`
 * records until `stop`, which sends the capture to be transcribed (and
 * tidied, server-side) and appends the text to `value` via `onChange`.
 * Appends rather than replaces — dictation adds to what's typed, and a
 * draft edited while transcription is in flight keeps that edit. A hold
 * released before the microphone came live, or too short to hold speech,
 * sends nothing and says so. The input choice persists across pages and
 * reloads. Unavailable (and inert) until the models listing reports a
 * transcription model and the recorder can capture.
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
  // The open microphone, and the open in progress before it is.
  const mic = useRef<Microphone | null>(null);
  const opening = useRef<Promise<Microphone> | null>(null);
  // Whether the hold is still down, and the recording once one is running.
  const holding = useRef(false);
  const recording = useRef<{ active: Recording; since: number } | null>(null);

  const refreshInputs = useCallback(() => {
    void recorder.listInputs().then(setInputs, () => undefined);
  }, [recorder]);

  // Open the chosen input while available, and release it on leaving or
  // when the choice changes. A refusal on arrival stays quiet — the hold
  // that needs the microphone asks again and reports.
  useEffect(() => {
    if (!available) return;
    let live = true;
    const pending = recorder.open(deviceId).then((open) => {
      if (!live) {
        open.close();
        throw new Error("microphone closed");
      }
      mic.current = open;
      return open;
    });
    opening.current = pending;
    pending.then(
      () => {
        opening.current = null;
        refreshInputs();
      },
      () => {
        opening.current = null;
      },
    );
    return () => {
      live = false;
      holding.current = false;
      void recording.current?.active.stop();
      recording.current = null;
      mic.current?.close();
      mic.current = null;
    };
  }, [available, recorder, deviceId, refreshInputs]);

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
        setStatus("idle");
      }
    },
    [onChange, minCaptureMs],
  );

  const begin = useCallback((open: Microphone) => {
    recording.current = { active: open.record(), since: Date.now() };
    setStatus("recording");
  }, []);

  const start = useCallback(() => {
    if (!available || status !== "idle" || holding.current) return;
    holding.current = true;
    setError(undefined);
    if (mic.current) {
      begin(mic.current);
      return;
    }
    setStatus("starting");
    // Still opening from arrival, or that open was refused: ask again.
    const pending =
      opening.current ??
      recorder.open(deviceId).then((open) => {
        mic.current = open;
        return open;
      });
    pending.then(
      (open) => {
        if (holding.current) {
          begin(open);
          return;
        }
        // Released while the microphone was still coming live: nothing was
        // captured, but it is open now, so the next hold records at once.
        setStatus("idle");
        setError(NOTHING_CAPTURED);
      },
      (cause: unknown) => {
        holding.current = false;
        setStatus("idle");
        setError(cause instanceof Error ? cause.message : "microphone unavailable");
      },
    );
  }, [available, status, recorder, deviceId, begin]);

  const stop = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    const current = recording.current;
    recording.current = null;
    if (current) void finish(current.active, current.since);
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
