/** A microphone recording in progress. */
export interface Recording {
  /** End the recording, resolving to the captured audio. The microphone stays open. */
  stop(): Promise<Blob>;
}

/** An open microphone: records on demand until closed. */
export interface Microphone {
  /** Start a recording. */
  record(): Recording;
  /** Release the microphone. */
  close(): void;
}

/** One audio input the browser can open. */
export interface AudioInput {
  id: string;
  label: string;
}

/**
 * Seam over the browser's microphone capture (`getUserMedia` plus
 * `MediaRecorder`) so push-to-talk is drivable in tests, mirroring the
 * notifications' `Notifier` seam. Opening takes a while (a permission
 * prompt on first use, then device start-up), and the browser shows a
 * recording indicator for as long as a microphone is open, so one is opened
 * for a hold and closed as soon as its capture is in hand.
 */
export interface Recorder {
  /** Whether this browser can capture audio at all. */
  supported(): boolean;
  /**
   * The audio inputs on offer. Browsers withhold labels until microphone
   * access has been granted, so this asks for it once when they are blank.
   */
  listInputs(): Promise<AudioInput[]>;
  /**
   * Ask for the microphone (the browser prompts on first use) and open it —
   * `deviceId`'s input by preference, the browser's default when that is
   * absent or no longer present.
   */
  open(deviceId?: string): Promise<Microphone>;
}

// Read lazily rather than at module load: the globals are absent in
// unsupported environments, and tests install fakes after import.
const mediaRecorderCtor = (): typeof MediaRecorder | undefined =>
  (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
const mediaDevices = (): MediaDevices | undefined => navigator.mediaDevices;

// Browsers suffix a USB input's name with its vendor and product ids —
// "Shure MV7PLUS (14ed:1019)" — which name nothing to a person.
const TRAILING_BRACKETS = /\s*\([^)]*\)\s*$/;

const audioInputs = async (): Promise<AudioInput[]> =>
  (await (mediaDevices() as MediaDevices).enumerateDevices())
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({ id: device.deviceId, label: device.label.replace(TRAILING_BRACKETS, "") }));

/** Production `Recorder` backed by the browser's `MediaRecorder`, in the container it picks. */
export const defaultRecorder: Recorder = {
  supported: () =>
    mediaRecorderCtor() !== undefined && typeof mediaDevices()?.getUserMedia === "function",
  listInputs: async () => {
    const inputs = await audioInputs();
    if (inputs.every((input) => input.label !== "")) return inputs;
    // Labels are withheld until access is granted: ask, release, ask again.
    const stream = await (mediaDevices() as MediaDevices).getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return audioInputs();
  },
  open: async (deviceId) => {
    const stream = await (mediaDevices() as MediaDevices).getUserMedia({
      audio: deviceId === undefined ? true : { deviceId: { ideal: deviceId } },
    });
    return {
      record: () => {
        const recorder = new (mediaRecorderCtor() as typeof MediaRecorder)(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.start();
        return {
          stop: () =>
            new Promise<Blob>((resolve) => {
              recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
              recorder.stop();
            }),
        };
      },
      close: () => {
        for (const track of stream.getTracks()) track.stop();
      },
    };
  },
};
