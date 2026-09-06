import { beforeEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { microphonePreference, setMicrophonePreference } from "./microphone-preference.ts";
import { PushToTalk } from "./push-to-talk.tsx";
import type { AudioInput, Microphone, Recorder } from "./recorder.ts";
import {
  DEFAULT_INPUT_LABEL,
  NOTHING_CAPTURED,
  type PushToTalkState,
  usePushToTalk,
} from "./use-push-to-talk.ts";

const MODEL = "openrouter:openai/whisper-1";
const INPUTS: AudioInput[] = [
  { id: "built-in", label: "MacBook Pro Microphone" },
  { id: "usb-1", label: "USB Audio" },
];

const modelsWith = (transcription?: string) =>
  http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [], transcription }));

const transcribing = (reply: string | ((audio: File) => string)) =>
  http.post("*/api/transcribe", async ({ request }) => {
    const audio = (await request.formData()).get("audio") as File;
    return HttpResponse.json({ text: typeof reply === "function" ? reply(audio) : reply });
  });

// A recorder whose microphone opens when the test says so, capturing `audio`
// on every recording, and counting opens (with the device asked for),
// recordings, stops, closes, and listings.
const fakeRecorder = (
  opts: { supported?: boolean; audio?: string; ready?: boolean; inputs?: AudioInput[] } = {},
) => {
  const { supported = true, audio = "spoken", ready = true, inputs = INPUTS } = opts;
  let resolveOpen: ((mic: Microphone) => void) | undefined;
  const counts = { opens: 0, records: 0, stops: 0, closes: 0, listings: 0 };
  const opened: (string | undefined)[] = [];
  const mic: Microphone = {
    record: () => {
      counts.records += 1;
      return {
        stop: async () => {
          counts.stops += 1;
          return new Blob([audio], { type: "audio/webm" });
        },
      };
    },
    close: () => {
      counts.closes += 1;
    },
  };
  const recorder: Recorder = {
    supported: () => supported,
    listInputs: async () => {
      counts.listings += 1;
      return inputs;
    },
    open: (deviceId) => {
      counts.opens += 1;
      opened.push(deviceId);
      return new Promise<Microphone>((resolve) => {
        if (ready) resolve(mic);
        else resolveOpen = resolve;
      });
    },
  };
  return { recorder, counts, opened, makeReady: () => resolveOpen?.(mic) };
};

// A composer stand-in: the controlled draft the real composer owns, with the
// push-to-talk control bound to it the way the chat page binds it, plus the
// device state the settings popover will drive. Captures count however
// short unless a test says otherwise.
function Harness({
  initial = "",
  recorder,
  minCaptureMs = 0,
  onState,
}: {
  initial?: string;
  recorder: Recorder;
  minCaptureMs?: number;
  onState?: (state: PushToTalkState) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const state = usePushToTalk({ value: draft, onChange: setDraft, recorder, minCaptureMs });
  onState?.(state);
  return (
    <>
      <textarea aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <PushToTalk state={state} />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <output aria-label="Microphone">{state.deviceLabel}</output>
      <button type="button" onClick={() => state.setDevice("usb-1")}>
        use usb
      </button>
      <button type="button" onClick={() => state.setDevice(undefined)}>
        use default
      </button>
      <button type="button" onClick={state.refreshInputs}>
        refresh inputs
      </button>
    </>
  );
}

const renderHarness = (
  recorder: Recorder,
  props: {
    initial?: string;
    minCaptureMs?: number;
    onState?: (state: PushToTalkState) => void;
  } = {},
) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness recorder={recorder} {...props} />
    </QueryClientProvider>,
  );

const draftBox = () => screen.getByLabelText("Draft") as HTMLTextAreaElement;
const talkButton = () => screen.findByRole("button", { name: "hold to talk" });
// The mic button whatever it currently reads — the harness has other buttons.
const micButton = () => screen.getByTitle("Hold to talk; release to transcribe into the draft");
const hold = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
const release = (button: HTMLElement) => fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
// Hold, and wait for the microphone to be recording before the test releases.
const holdUntilListening = async () => {
  hold(await talkButton());
  await screen.findByRole("button", { name: "listening…" });
};

describe("<PushToTalk>", () => {
  beforeEach(() => localStorage.clear());

  it("renders nothing, and opens no microphone, when no transcription model is configured", async () => {
    server.use(modelsWith(undefined));
    const { recorder, counts } = fakeRecorder();
    renderHarness(recorder);

    // Give the models query a chance to settle before asserting absence.
    await waitFor(() => expect(screen.queryByRole("button", { name: /talk/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /talk/ })).toBeNull();
    expect(counts.opens).toBe(0);
  });

  it("renders nothing when the browser cannot record, even with a model configured", async () => {
    server.use(modelsWith(MODEL));
    const { recorder, counts } = fakeRecorder({ supported: false });
    renderHarness(recorder);

    await waitFor(() => expect(screen.queryByRole("button", { name: /talk/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /talk/ })).toBeNull();
    expect(counts.opens).toBe(0);
  });

  it("opens the browser's default microphone for the hold, and gives it back once the capture is in hand", async () => {
    let sent: File | undefined;
    let answer: (() => void) | undefined;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", async ({ request }) => {
        sent = (await request.formData()).get("audio") as File;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ text: "Use Postgres." });
      }),
    );
    const { recorder, counts, opened } = fakeRecorder({ audio: "hello" });
    let latest: PushToTalkState | undefined;
    renderHarness(recorder, {
      onState: (state) => {
        latest = state;
      },
    });

    // Nothing is opened, or listed, until a hold needs the microphone.
    const button = await talkButton();
    expect(counts.opens).toBe(0);
    expect(latest?.inputs).toEqual([]);
    expect(screen.getByLabelText("Microphone").textContent).toBe(DEFAULT_INPUT_LABEL);

    hold(button);
    expect(await screen.findByRole("button", { name: "listening…" })).toBeDefined();
    expect(opened).toEqual([undefined]);
    await waitFor(() => expect(latest?.inputs).toEqual(INPUTS));

    // Released: the microphone is closed before the transcription lands.
    release(micButton());
    expect(await screen.findByRole("button", { name: "transcribing…" })).toBeDefined();
    await waitFor(() => expect(answer).toBeDefined());
    expect(counts.closes).toBe(1);
    answer?.();

    await waitFor(() => expect(draftBox().value).toBe("Use Postgres."));
    expect(await talkButton()).toBeDefined();
    expect(sent?.size).toBe(5);
    expect(counts).toEqual({ opens: 1, records: 1, stops: 1, closes: 1, listings: 1 });

    // The next hold opens it afresh.
    await holdUntilListening();
    expect(counts.opens).toBe(2);
  });

  it("names the remembered input on arrival without opening it, and a hold opens it", async () => {
    server.use(modelsWith(MODEL), transcribing("spoken"));
    setMicrophonePreference("usb-1");
    const { recorder, counts, opened } = fakeRecorder();
    renderHarness(recorder);

    await talkButton();
    await waitFor(() => expect(screen.getByLabelText("Microphone").textContent).toBe("USB Audio"));
    expect(counts).toEqual({ opens: 0, records: 0, stops: 0, closes: 0, listings: 1 });

    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("spoken"));
    expect(opened).toEqual(["usb-1"]);
  });

  it("switching input persists the choice, which the next hold opens", async () => {
    server.use(modelsWith(MODEL), transcribing("spoken"));
    setMicrophonePreference("usb-1");
    const user = userEvent.setup();
    const { recorder, opened } = fakeRecorder();
    renderHarness(recorder);
    await talkButton();

    await user.click(screen.getByRole("button", { name: "use default" }));
    expect(microphonePreference()).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByLabelText("Microphone").textContent).toBe(DEFAULT_INPUT_LABEL),
    );
    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("spoken"));
    expect(opened).toEqual([undefined]);

    await user.click(screen.getByRole("button", { name: "use usb" }));
    expect(microphonePreference()).toBe("usb-1");
    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("spoken spoken"));
    expect(opened).toEqual([undefined, "usb-1"]);
  });

  it("shows the browser default when the remembered input is no longer listed", async () => {
    server.use(modelsWith(MODEL));
    setMicrophonePreference("gone");
    renderHarness(fakeRecorder().recorder);

    await talkButton();
    await waitFor(() =>
      expect(screen.getByLabelText("Microphone").textContent).toBe(DEFAULT_INPUT_LABEL),
    );
  });

  it("carries on with no inputs listed when listing them fails", async () => {
    server.use(modelsWith(MODEL), transcribing("still works"));
    const { recorder } = fakeRecorder();
    recorder.listInputs = async () => {
      throw new Error("enumerateDevices unavailable");
    };
    let latest: PushToTalkState | undefined;
    renderHarness(recorder, {
      onState: (state) => {
        latest = state;
      },
    });

    await holdUntilListening();
    release(micButton());

    await waitFor(() => expect(draftBox().value).toBe("still works"));
    expect(latest?.inputs).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists the inputs on request without opening the microphone", async () => {
    server.use(modelsWith(MODEL));
    const user = userEvent.setup();
    const { recorder, counts } = fakeRecorder();
    renderHarness(recorder);
    await talkButton();
    expect(counts.listings).toBe(0);

    await user.click(screen.getByRole("button", { name: "refresh inputs" }));

    await waitFor(() => expect(counts.listings).toBe(1));
    expect(counts.opens).toBe(0);
  });

  it("reads starting until a slow microphone comes live, then records", async () => {
    server.use(modelsWith(MODEL), transcribing("late"));
    const { recorder, counts, makeReady } = fakeRecorder({ ready: false });
    renderHarness(recorder);

    const button = await talkButton();
    hold(button);
    expect(await screen.findByRole("button", { name: "starting mic…" })).toBeDefined();
    makeReady();
    expect(await screen.findByRole("button", { name: "listening…" })).toBeDefined();

    release(micButton());

    await waitFor(() => expect(draftBox().value).toBe("late"));
    expect(counts.opens).toBe(1);
  });

  it("reports a refused microphone on the hold that asked, and records once granted", async () => {
    server.use(modelsWith(MODEL), transcribing("ok now"));
    let refusals = 1;
    const { recorder, counts } = fakeRecorder();
    const open = recorder.open;
    recorder.open = async (deviceId) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new DOMException("Permission denied", "NotAllowedError");
      }
      return open(deviceId);
    };
    renderHarness(recorder);

    // Nothing is asked for on arrival, so nothing is refused.
    const button = await talkButton();
    expect(refusals).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();

    hold(button);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Permission denied");
    expect(await talkButton()).toBeDefined();

    // Granted on the next ask.
    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("ok now"));
    expect(counts.opens).toBe(1);
  });

  it("shows a hollow ring until the microphone is live, a red dot while listening, and a blue one while transcribing", async () => {
    let answer: (() => void) | undefined;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ text: "spoken" });
      }),
    );
    const { recorder, makeReady } = fakeRecorder({ ready: false });
    renderHarness(recorder);
    const indicator = () => micButton().querySelector("span[aria-hidden='true'] > span");

    // Idle: the glyph, and no indicator.
    const button = await talkButton();
    expect(indicator()).toBeNull();

    // Pressed: a hollow ring says the microphone is still coming up.
    hold(button);
    await screen.findByRole("button", { name: "starting mic…" });
    expect(indicator()?.className).toContain("border-status-failed");
    expect(indicator()?.className).not.toContain("bg-status-failed");

    // Live: the ring fills — the cue to speak.
    makeReady();
    await screen.findByRole("button", { name: "listening…" });
    expect(indicator()?.className).toContain("bg-status-failed");
    expect(indicator()?.className).toContain("animate-pulse");

    // Released: blue while the capture is transcribed.
    release(micButton());
    await screen.findByRole("button", { name: "transcribing…" });
    expect(indicator()?.className).toContain("bg-status-running");
    answer?.();

    // Done: the glyph again.
    await waitFor(() => expect(draftBox().value).toBe("spoken"));
    expect(await talkButton()).toBeDefined();
    expect(indicator()).toBeNull();
  });

  it("appends the spoken text to a draft, after a space unless it already ends in one", async () => {
    server.use(modelsWith(MODEL), transcribing("and Redis."));
    const { recorder } = fakeRecorder();
    const first = renderHarness(recorder, { initial: "Use Postgres" });
    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("Use Postgres and Redis."));
    first.unmount();

    renderHarness(recorder, { initial: "Use Postgres\n" });
    await holdUntilListening();
    release(micButton());
    await waitFor(() => expect(draftBox().value).toBe("Use Postgres\nand Redis."));
  });

  it("appends to the draft as it stands when the text lands, keeping an edit made meanwhile", async () => {
    const user = userEvent.setup();
    let answer: (() => void) | undefined;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ text: "spoken" });
      }),
    );
    renderHarness(fakeRecorder().recorder);

    await holdUntilListening();
    release(micButton());
    await screen.findByRole("button", { name: "transcribing…" });
    await user.type(draftBox(), "typed");
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();

    await waitFor(() => expect(draftBox().value).toBe("typed spoken"));
  });

  it("sends nothing for a hold released before the microphone came live", async () => {
    let requests = 0;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", () => {
        requests += 1;
        return HttpResponse.json({ text: "never" });
      }),
    );
    const { recorder, counts, makeReady } = fakeRecorder({ ready: false });
    renderHarness(recorder);

    const button = await talkButton();
    hold(button);
    await screen.findByRole("button", { name: "starting mic…" });
    release(button);

    makeReady();

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", NOTHING_CAPTURED);
    expect(await talkButton()).toBeDefined();
    expect(requests).toBe(0);
    expect(counts.records).toBe(0);
    expect(draftBox().value).toBe("");
    // The microphone that came live unwanted is given straight back.
    expect(counts.closes).toBe(1);

    // The next hold opens it afresh.
    hold(await talkButton());
    await screen.findByRole("button", { name: "starting mic…" });
    makeReady();
    expect(await screen.findByRole("button", { name: "listening…" })).toBeDefined();
    expect(counts.opens).toBe(2);
  });

  it("sends nothing for a capture too short to hold speech, or with no audio in it", async () => {
    let requests = 0;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", () => {
        requests += 1;
        return HttpResponse.json({ text: "never" });
      }),
    );
    const short = renderHarness(fakeRecorder().recorder, { minCaptureMs: 60_000 });
    await holdUntilListening();
    release(micButton());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", NOTHING_CAPTURED);
    expect(await talkButton()).toBeDefined();
    short.unmount();

    renderHarness(fakeRecorder({ audio: "" }).recorder);
    await holdUntilListening();
    release(micButton());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", NOTHING_CAPTURED);
    expect(await talkButton()).toBeDefined();

    expect(requests).toBe(0);
    expect(draftBox().value).toBe("");
  });

  it("leaves the draft alone when nothing was said", async () => {
    server.use(modelsWith(MODEL), transcribing(""));
    renderHarness(fakeRecorder().recorder, { initial: "typed" });

    await holdUntilListening();
    release(micButton());

    expect(await talkButton()).toBeDefined();
    expect(draftBox().value).toBe("typed");
  });

  it("shows a failed transcription inline and clears it on the next hold", async () => {
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", () =>
        HttpResponse.json({ error: "provider down" }, { status: 502 }),
      ),
    );
    renderHarness(fakeRecorder().recorder);

    await holdUntilListening();
    release(micButton());
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "provider down");

    await holdUntilListening();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a hold while a transcription is still in flight", async () => {
    let answer: (() => void) | undefined;
    server.use(
      modelsWith(MODEL),
      http.post("*/api/transcribe", async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ text: "once" });
      }),
    );
    const { recorder, counts } = fakeRecorder();
    renderHarness(recorder);

    await holdUntilListening();
    release(micButton());
    await screen.findByRole("button", { name: "transcribing…" });
    hold(micButton());
    release(micButton());
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();

    await waitFor(() => expect(draftBox().value).toBe("once"));
    expect(counts.records).toBe(1);
  });

  it("releases the microphone when unmounted, dropping a hold in progress", async () => {
    server.use(modelsWith(MODEL));
    const { recorder, counts } = fakeRecorder();
    const view = renderHarness(recorder);

    await holdUntilListening();
    view.unmount();

    await waitFor(() => expect(counts.closes).toBe(1));
    expect(counts.stops).toBe(1);
  });

  it("closes a microphone that came live only after the page was left", async () => {
    server.use(modelsWith(MODEL));
    const { recorder, counts, makeReady } = fakeRecorder({ ready: false });
    const view = renderHarness(recorder);
    hold(await talkButton());
    await screen.findByRole("button", { name: "starting mic…" });
    expect(counts.opens).toBe(1);

    view.unmount();
    makeReady();

    await waitFor(() => expect(counts.closes).toBe(1));
  });
});
