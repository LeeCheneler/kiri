import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { PushToTalk } from "./push-to-talk.tsx";
import type { Microphone, Recorder } from "./recorder.ts";
import { NOTHING_CAPTURED, usePushToTalk } from "./use-push-to-talk.ts";

const MODEL = "openrouter:openai/whisper-1";

const modelsWith = (transcription?: string) =>
  http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [], transcription }));

const transcribing = (reply: string | ((audio: File) => string)) =>
  http.post("*/api/transcribe", async ({ request }) => {
    const audio = (await request.formData()).get("audio") as File;
    return HttpResponse.json({ text: typeof reply === "function" ? reply(audio) : reply });
  });

// A recorder whose microphone opens when the test says so, capturing `audio`
// on every recording, and counting opens, recordings, stops, and closes.
const fakeRecorder = (opts: { supported?: boolean; audio?: string; ready?: boolean } = {}) => {
  const { supported = true, audio = "spoken", ready = true } = opts;
  let resolveOpen: ((mic: Microphone) => void) | undefined;
  const counts = { opens: 0, records: 0, stops: 0, closes: 0 };
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
    listInputs: async () => [],
    open: () => {
      counts.opens += 1;
      return new Promise<Microphone>((resolve) => {
        if (ready) resolve(mic);
        else resolveOpen = resolve;
      });
    },
  };
  return { recorder, counts, makeReady: () => resolveOpen?.(mic) };
};

// A composer stand-in: the controlled draft the real composer owns, with the
// push-to-talk control bound to it the way the chat page binds it. Captures
// count however short unless a test says otherwise.
function Harness({
  initial = "",
  recorder,
  warmMs,
  minCaptureMs = 0,
}: {
  initial?: string;
  recorder: Recorder;
  warmMs?: number;
  minCaptureMs?: number;
}) {
  const [draft, setDraft] = useState(initial);
  const state = usePushToTalk({ value: draft, onChange: setDraft, recorder, warmMs, minCaptureMs });
  return (
    <>
      <textarea aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <PushToTalk state={state} />
    </>
  );
}

const renderHarness = (
  recorder: Recorder,
  props: { initial?: string; warmMs?: number; minCaptureMs?: number } = {},
) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness recorder={recorder} {...props} />
    </QueryClientProvider>,
  );

const draftBox = () => screen.getByLabelText("Draft") as HTMLTextAreaElement;
const talkButton = () => screen.findByRole("button", { name: "hold to talk" });
const hold = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
const release = (button: HTMLElement) => fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
// Hold, and wait for the microphone to come live before the test releases.
const holdUntilListening = async () => {
  hold(await talkButton());
  await screen.findByRole("button", { name: "listening…" });
};

describe("<PushToTalk>", () => {
  it("renders nothing when no transcription model is configured", async () => {
    server.use(modelsWith(undefined));
    renderHarness(fakeRecorder().recorder);

    // Give the models query a chance to settle before asserting absence.
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when the browser cannot record, even with a model configured", async () => {
    server.use(modelsWith(MODEL));
    renderHarness(fakeRecorder({ supported: false }).recorder);

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the microphone on the first hold, records while held, then transcribes into the empty draft", async () => {
    let sent: File | undefined;
    server.use(
      modelsWith(MODEL),
      transcribing((audio) => {
        sent = audio;
        return "Use Postgres.";
      }),
    );
    const { recorder, counts, makeReady } = fakeRecorder({ audio: "hello", ready: false });
    renderHarness(recorder);

    const button = await talkButton();
    hold(button);
    expect(await screen.findByRole("button", { name: "starting mic…" })).toBeDefined();
    makeReady();
    expect(await screen.findByRole("button", { name: "listening…" })).toBeDefined();

    release(button);
    expect(await screen.findByText("transcribing…")).toBeDefined();

    await waitFor(() => expect(draftBox().value).toBe("Use Postgres."));
    expect(await talkButton()).toBeDefined();
    expect(sent?.size).toBe(5);
    expect(counts).toEqual({ opens: 1, records: 1, stops: 1, closes: 0 });
  });

  it("keeps the microphone warm for the next hold, and closes it once unused", async () => {
    server.use(modelsWith(MODEL), transcribing("again"));
    const { recorder, counts } = fakeRecorder();
    renderHarness(recorder, { warmMs: 500 });

    await holdUntilListening();
    release(screen.getByRole("button"));
    await waitFor(() => expect(draftBox().value).toBe("again"));

    await holdUntilListening();
    release(screen.getByRole("button"));
    await waitFor(() => expect(draftBox().value).toBe("again again"));
    expect(counts.opens).toBe(1);
    expect(counts.records).toBe(2);

    await waitFor(() => expect(counts.closes).toBe(1));

    // Closed, so the next hold opens afresh.
    await holdUntilListening();
    expect(counts.opens).toBe(2);
  });

  it("appends the spoken text to a draft, after a space unless it already ends in one", async () => {
    server.use(modelsWith(MODEL), transcribing("and Redis."));
    const { recorder } = fakeRecorder();
    const first = renderHarness(recorder, { initial: "Use Postgres" });
    await holdUntilListening();
    release(screen.getByRole("button"));
    await waitFor(() => expect(draftBox().value).toBe("Use Postgres and Redis."));
    first.unmount();

    renderHarness(recorder, { initial: "Use Postgres\n" });
    await holdUntilListening();
    release(screen.getByRole("button"));
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
    release(screen.getByRole("button"));
    await screen.findByText("transcribing…");
    await user.type(draftBox(), "typed");
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();

    await waitFor(() => expect(draftBox().value).toBe("typed spoken"));
  });

  it("sends nothing for a hold released before the microphone came live, keeping it warm once it is", async () => {
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
    expect(counts).toEqual({ opens: 1, records: 0, stops: 0, closes: 0 });
    expect(draftBox().value).toBe("");

    // Warm now, so the next hold records at once.
    await holdUntilListening();
    expect(counts.opens).toBe(1);
    expect(counts.records).toBe(1);
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
    release(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", NOTHING_CAPTURED);
    expect(await talkButton()).toBeDefined();
    short.unmount();

    renderHarness(fakeRecorder({ audio: "" }).recorder);
    await holdUntilListening();
    release(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", NOTHING_CAPTURED);
    expect(await talkButton()).toBeDefined();

    expect(requests).toBe(0);
    expect(draftBox().value).toBe("");
  });

  it("leaves the draft alone when nothing was said", async () => {
    server.use(modelsWith(MODEL), transcribing(""));
    renderHarness(fakeRecorder().recorder, { initial: "typed" });

    await holdUntilListening();
    release(screen.getByRole("button"));

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
    release(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "provider down");

    await holdUntilListening();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a refused microphone inline and returns to idle", async () => {
    server.use(modelsWith(MODEL));
    const recorder: Recorder = {
      supported: () => true,
      listInputs: async () => [],
      open: async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      },
    };
    renderHarness(recorder);

    hold(await talkButton());

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Permission denied");
    expect(await talkButton()).toBeDefined();
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
    release(screen.getByRole("button"));
    await screen.findByText("transcribing…");
    // The pending button is disabled, so drive the state directly through
    // the events it would receive were it not.
    hold(screen.getByRole("button"));
    release(screen.getByRole("button"));
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();

    await waitFor(() => expect(draftBox().value).toBe("once"));
    expect(counts.records).toBe(1);
  });

  it("releases the microphone when unmounted mid-hold", async () => {
    server.use(modelsWith(MODEL));
    const { recorder, counts } = fakeRecorder();
    const view = renderHarness(recorder);

    await holdUntilListening();
    view.unmount();

    await waitFor(() => expect(counts).toEqual({ opens: 1, records: 1, stops: 1, closes: 1 }));
  });
});
