import { afterEach, describe, expect, it } from "bun:test";
import {
  FakeMediaRecorder,
  installFakeMedia,
  uninstallFakeMedia,
} from "../../../../tests/setup/fake-media-recorder.ts";
import { defaultRecorder } from "./recorder.ts";

describe("defaultRecorder", () => {
  afterEach(uninstallFakeMedia);

  it("is unsupported without MediaRecorder or media devices", () => {
    expect(defaultRecorder.supported()).toBe(false);
  });

  it("is supported once both are present", () => {
    installFakeMedia();
    expect(defaultRecorder.supported()).toBe(true);
  });

  it("records the microphone, and on stop releases it and resolves the capture in the recorder's container", async () => {
    installFakeMedia();

    const recording = await defaultRecorder.start();
    const recorder = FakeMediaRecorder.instances[0] as FakeMediaRecorder;
    expect(recorder.state).toBe("recording");

    const audio = await recording.stop();

    expect(recorder.state).toBe("inactive");
    expect(audio.type).toBe("audio/webm");
    expect(await audio.text()).toBe("audio");
    expect(recorder.stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("resolves an empty capture when the recorder delivered nothing", async () => {
    installFakeMedia();
    FakeMediaRecorder.chunk = null;

    const recording = await defaultRecorder.start();
    const audio = await recording.stop();

    expect(audio.size).toBe(0);
  });

  it("skips empty chunks the recorder delivers", async () => {
    installFakeMedia();
    FakeMediaRecorder.chunk = new Blob([], { type: "audio/webm" });

    const recording = await defaultRecorder.start();
    const audio = await recording.stop();

    expect(audio.size).toBe(0);
  });

  it("rejects when the microphone is refused", async () => {
    installFakeMedia({ denied: true });

    await expect(defaultRecorder.start()).rejects.toThrow("Permission denied");
  });
});
