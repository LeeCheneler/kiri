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

/**
 * Seam over the browser's microphone capture (`getUserMedia` plus
 * `MediaRecorder`) so push-to-talk is drivable in tests, mirroring the
 * notifications' `Notifier` seam. Opening takes a while (a permission
 * prompt on first use, then device start-up — a second or two is normal),
 * so a microphone is opened once and kept for a run of recordings.
 */
export interface Recorder {
  /** Whether this browser can capture audio at all. */
  supported(): boolean;
  /** Ask for the microphone (the browser prompts on first use) and open it. */
  open(): Promise<Microphone>;
}

// Read lazily rather than at module load: the globals are absent in
// unsupported environments, and tests install fakes after import.
const mediaRecorderCtor = (): typeof MediaRecorder | undefined =>
  (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
const mediaDevices = (): MediaDevices | undefined => navigator.mediaDevices;

/** Production `Recorder` backed by the browser's `MediaRecorder`, in the container it picks. */
export const defaultRecorder: Recorder = {
  supported: () =>
    mediaRecorderCtor() !== undefined && typeof mediaDevices()?.getUserMedia === "function",
  open: async () => {
    const stream = await (mediaDevices() as MediaDevices).getUserMedia({ audio: true });
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
