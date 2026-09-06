/** Test double for a `MediaStream`: tracks that record being stopped. */
export class FakeMediaStream {
  readonly tracks: { stopped: boolean; stop(): void }[];
  constructor() {
    const track = {
      stopped: false,
      stop() {
        track.stopped = true;
      },
    };
    this.tracks = [track];
  }
  getTracks() {
    return this.tracks;
  }
}

/**
 * Test double for the browser's `MediaRecorder`, installed on globalThis by
 * `installFakeMedia` so `defaultRecorder`'s lazy lookup finds it. `stop()`
 * delivers `FakeMediaRecorder.chunk` (set it to `null` for a capture with
 * nothing in it) through `ondataavailable`, then fires `onstop`.
 */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static chunk: Blob | null = new Blob(["audio"], { type: "audio/webm" });
  readonly mimeType = "audio/webm";
  readonly stream: FakeMediaStream;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(stream: FakeMediaStream) {
    this.stream = stream;
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (FakeMediaRecorder.chunk) this.ondataavailable?.({ data: FakeMediaRecorder.chunk });
    this.onstop?.();
  }
}

type Globals = { MediaRecorder?: unknown };

/**
 * Install the fake `MediaRecorder` and a `navigator.mediaDevices` whose
 * `getUserMedia` hands out a `FakeMediaStream` — or, with `denied`, rejects
 * the way a refused microphone prompt does.
 */
export const installFakeMedia = (opts: { denied?: boolean } = {}): void => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.chunk = new Blob(["audio"], { type: "audio/webm" });
  (globalThis as Globals).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (opts.denied) throw new DOMException("Permission denied", "NotAllowedError");
        return new FakeMediaStream();
      },
    },
  });
};

/** Remove the fakes, leaving the environment without media capture as happy-dom ships it. */
export const uninstallFakeMedia = (): void => {
  (globalThis as Globals).MediaRecorder = undefined;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
};
