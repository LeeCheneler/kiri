import { beforeEach, describe, expect, it } from "bun:test";
import { microphonePreference, setMicrophonePreference } from "./microphone-preference.ts";

describe("microphone preference", () => {
  beforeEach(() => localStorage.clear());

  it("is the browser default until set", () => {
    expect(microphonePreference()).toBeUndefined();
  });

  it("persists a chosen device and clears back to the default", () => {
    setMicrophonePreference("usb-1");
    expect(microphonePreference()).toBe("usb-1");

    setMicrophonePreference(undefined);
    expect(microphonePreference()).toBeUndefined();
  });
});
