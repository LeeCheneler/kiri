/** A microphone recording in progress. */
export interface Recording {
  /** End the recording and release the microphone, resolving to the captured audio. */
  stop(): Promise<Blob>;
}

/**
 * Seam over the browser's microphone capture (`getUserMedia` plus
 * `MediaRecorder`) so push-to-talk is drivable in tests, mirroring the
 * notifications' `Notifier` seam.
 */
export interface Recorder {
  /** Whether this browser can capture audio at all. */
  supported(): boolean;
  /** Ask for the microphone (the browser prompts on first use) and start recording. */
  start(): Promise<Recording>;
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
  start: async () => {
    const stream = await (mediaDevices() as MediaDevices).getUserMedia({ audio: true });
    const recorder = new (mediaRecorderCtor() as typeof MediaRecorder)(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    return {
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            for (const track of stream.getTracks()) track.stop();
            resolve(new Blob(chunks, { type: recorder.mimeType }));
          };
          recorder.stop();
        }),
    };
  },
};
