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

  it("records the open microphone, resolving the capture in the recorder's container and keeping the microphone open", async () => {
    installFakeMedia();

    const mic = await defaultRecorder.open();
    const recording = mic.record();
    const recorder = FakeMediaRecorder.instances[0] as FakeMediaRecorder;
    expect(recorder.state).toBe("recording");

    const audio = await recording.stop();

    expect(recorder.state).toBe("inactive");
    expect(audio.type).toBe("audio/webm");
    expect(await audio.text()).toBe("audio");
    expect(recorder.stream.tracks.every((track) => track.stopped)).toBe(false);
  });

  it("records again on the same microphone, and close releases it", async () => {
    installFakeMedia();

    const mic = await defaultRecorder.open();
    await mic.record().stop();
    await mic.record().stop();
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    const stream = (FakeMediaRecorder.instances[0] as FakeMediaRecorder).stream;
    expect((FakeMediaRecorder.instances[1] as FakeMediaRecorder).stream).toBe(stream);

    mic.close();

    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("resolves an empty capture when the recorder delivered nothing, skipping empty chunks", async () => {
    installFakeMedia();
    const mic = await defaultRecorder.open();

    FakeMediaRecorder.chunk = null;
    expect((await mic.record().stop()).size).toBe(0);

    FakeMediaRecorder.chunk = new Blob([], { type: "audio/webm" });
    expect((await mic.record().stop()).size).toBe(0);
  });

  it("rejects when the microphone is refused", async () => {
    installFakeMedia({ denied: true });

    await expect(defaultRecorder.open()).rejects.toThrow("Permission denied");
  });
});
