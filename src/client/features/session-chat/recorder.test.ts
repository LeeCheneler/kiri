import { afterEach, describe, expect, it } from "bun:test";
import {
  FakeMediaRecorder,
  installFakeMedia,
  uninstallFakeMedia,
} from "../../../../tests/setup/fake-media-recorder.ts";
import { defaultRecorder } from "./recorder.ts";

const INPUTS = [
  { id: "default", label: "MacBook Pro Microphone" },
  { id: "usb-1", label: "USB Audio" },
];
const USB_INPUTS = [{ id: "usb-2", label: "Shure MV7PLUS (14ed:1019)" }];

describe("defaultRecorder", () => {
  afterEach(uninstallFakeMedia);

  it("is unsupported without MediaRecorder or media devices", () => {
    expect(defaultRecorder.supported()).toBe(false);
  });

  it("is supported once both are present", () => {
    installFakeMedia();
    expect(defaultRecorder.supported()).toBe(true);
  });

  it("lists the audio inputs, asking for access once to unlock their labels", async () => {
    const media = installFakeMedia({ inputs: INPUTS });

    const inputs = await defaultRecorder.listInputs();

    expect(inputs).toEqual(INPUTS);
    expect(media.requests).toEqual([true]);
    // The access request was only for the labels: nothing stays open.
    expect(media.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("drops the bracketed hardware id a browser appends to an input's name", async () => {
    installFakeMedia({ inputs: USB_INPUTS });

    expect(await defaultRecorder.listInputs()).toEqual([{ id: "usb-2", label: "Shure MV7PLUS" }]);
  });

  it("lists without asking again once labels are known", async () => {
    const media = installFakeMedia({ inputs: INPUTS });
    await defaultRecorder.listInputs();

    const inputs = await defaultRecorder.listInputs();

    expect(inputs).toEqual(INPUTS);
    expect(media.requests).toHaveLength(1);
  });

  it("opens the browser's default input without a device, and prefers the given one with", async () => {
    const media = installFakeMedia({ inputs: INPUTS });

    (await defaultRecorder.open()).close();
    (await defaultRecorder.open("usb-1")).close();

    expect(media.requests).toEqual([true, { deviceId: { ideal: "usb-1" } }]);
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
