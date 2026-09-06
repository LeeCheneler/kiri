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

/** What the fake `navigator.mediaDevices` saw and did, for assertions. */
export interface FakeMediaState {
  /** The `audio` constraint of every `getUserMedia` call, in order. */
  requests: unknown[];
  /** Every stream handed out, in order. */
  streams: FakeMediaStream[];
}

/**
 * Install the fake `MediaRecorder` and a `navigator.mediaDevices` whose
 * `getUserMedia` hands out a `FakeMediaStream` — or, with `denied`, rejects
 * the way a refused microphone prompt does — and whose `enumerateDevices`
 * lists `inputs` as audio inputs, their labels blank until a stream has been
 * granted, as browsers do.
 */
export const installFakeMedia = (
  opts: { denied?: boolean; inputs?: { id: string; label: string }[] } = {},
): FakeMediaState => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.chunk = new Blob(["audio"], { type: "audio/webm" });
  const state: FakeMediaState = { requests: [], streams: [] };
  (globalThis as Globals).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints: { audio: unknown }) => {
        state.requests.push(constraints.audio);
        if (opts.denied) throw new DOMException("Permission denied", "NotAllowedError");
        const stream = new FakeMediaStream();
        state.streams.push(stream);
        return stream;
      },
      enumerateDevices: async () =>
        (opts.inputs ?? []).map((input) => ({
          kind: "audioinput",
          deviceId: input.id,
          label: state.streams.length > 0 ? input.label : "",
        })),
    },
  });
  return state;
};

/** Remove the fakes, leaving the environment without media capture as happy-dom ships it. */
export const uninstallFakeMedia = (): void => {
  (globalThis as Globals).MediaRecorder = undefined;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
};
