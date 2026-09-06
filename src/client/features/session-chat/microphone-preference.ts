const PREFERENCE_KEY = "kiri:push-to-talk:microphone";

/** The audio input push-to-talk opens, by device id; undefined for the browser's default. */
export const microphonePreference = (): string | undefined =>
  localStorage.getItem(PREFERENCE_KEY) ?? undefined;

/** Persist the audio input push-to-talk opens; undefined returns to the browser's default. */
export const setMicrophonePreference = (deviceId: string | undefined): void => {
  if (deviceId === undefined) localStorage.removeItem(PREFERENCE_KEY);
  else localStorage.setItem(PREFERENCE_KEY, deviceId);
};
