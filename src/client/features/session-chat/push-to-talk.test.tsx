import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { PushToTalk } from "./push-to-talk.tsx";
import type { Recorder, Recording } from "./recorder.ts";
import { usePushToTalk } from "./use-push-to-talk.ts";

const modelsWith = (transcription?: string) =>
  http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [], transcription }));

const transcribing = (reply: string | ((audio: File) => string)) =>
  http.post("*/api/transcribe", async ({ request }) => {
    const audio = (await request.formData()).get("audio") as File;
    return HttpResponse.json({ text: typeof reply === "function" ? reply(audio) : reply });
  });

// A recorder whose microphone comes ready when the test says so, capturing
// `audio` on stop and recording how many recordings were stopped.
const fakeRecorder = (opts: { supported?: boolean; audio?: string; ready?: boolean } = {}) => {
  const { supported = true, audio = "spoken", ready = true } = opts;
  let resolveStart: ((recording: Recording) => void) | undefined;
  const stops: number[] = [];
  const recording: Recording = {
    stop: async () => {
      stops.push(Date.now());
      return new Blob([audio], { type: "audio/webm" });
    },
  };
  const recorder: Recorder = {
    supported: () => supported,
    start: () =>
      new Promise<Recording>((resolve) => {
        if (ready) resolve(recording);
        else resolveStart = resolve;
      }),
  };
  return { recorder, stops, makeReady: () => resolveStart?.(recording) };
};

// A composer stand-in: the controlled draft the real composer owns, with the
// push-to-talk control bound to it the way the chat page binds it.
function Harness({ initial = "", recorder }: { initial?: string; recorder: Recorder }) {
  const [draft, setDraft] = useState(initial);
  const state = usePushToTalk({ value: draft, onChange: setDraft, recorder });
  return (
    <>
      <textarea aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <PushToTalk state={state} />
    </>
  );
}

const renderHarness = (recorder: Recorder, initial?: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness initial={initial} recorder={recorder} />
    </QueryClientProvider>,
  );

const draftBox = () => screen.getByLabelText("Draft") as HTMLTextAreaElement;
const talkButton = () => screen.findByRole("button", { name: "hold to talk" });
const hold = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
// Hold, and wait for the microphone to come live before the test releases.
const holdUntilListening = async () => {
  hold(await talkButton());
  await screen.findByRole("button", { name: "listening…" });
};
const release = (button: HTMLElement) => fireEvent.pointerUp(button, { button: 0, pointerId: 1 });

describe("<PushToTalk>", () => {
  it("renders nothing when no transcription model is configured", async () => {
    server.use(modelsWith(undefined));
    renderHarness(fakeRecorder().recorder);

    // Give the models query a chance to settle before asserting absence.
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when the browser cannot record, even with a model configured", async () => {
    server.use(modelsWith("openrouter:openai/whisper-1"));
    renderHarness(fakeRecorder({ supported: false }).recorder);

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("records while held, then transcribes the capture into the empty draft", async () => {
    let sent: File | undefined;
    server.use(
      modelsWith("openrouter:openai/whisper-1"),
      transcribing((audio) => {
        sent = audio;
        return "Use Postgres.";
      }),
    );
    renderHarness(fakeRecorder({ audio: "hello" }).recorder);

    const button = await talkButton();
    hold(button);
    expect(await screen.findByRole("button", { name: "listening…" })).toBeDefined();

    release(button);
    expect(await screen.findByText("transcribing…")).toBeDefined();

    await waitFor(() => expect(draftBox().value).toBe("Use Postgres."));
    expect(await talkButton()).toBeDefined();
    expect(sent?.size).toBe(5);
  });

  it("appends the spoken text to a draft, after a space unless it already ends in one", async () => {
    server.use(modelsWith("openrouter:openai/whisper-1"), transcribing("and Redis."));
    const { recorder } = fakeRecorder();
    const first = renderHarness(recorder, "Use Postgres");
    await holdUntilListening();
    release(screen.getByRole("button"));
    await waitFor(() => expect(draftBox().value).toBe("Use Postgres and Redis."));
    first.unmount();

    renderHarness(recorder, "Use Postgres\n");
    await holdUntilListening();
    release(screen.getByRole("button"));
    await waitFor(() => expect(draftBox().value).toBe("Use Postgres\nand Redis."));
  });

  it("appends to the draft as it stands when the text lands, keeping an edit made meanwhile", async () => {
    const user = userEvent.setup();
    let answer: (() => void) | undefined;
    server.use(
      modelsWith("openrouter:openai/whisper-1"),
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

  it("drops a hold released before the microphone was ready, releasing it once it is", async () => {
    let requests = 0;
    server.use(
      modelsWith("openrouter:openai/whisper-1"),
      http.post("*/api/transcribe", () => {
        requests += 1;
        return HttpResponse.json({ text: "never" });
      }),
    );
    const { recorder, stops, makeReady } = fakeRecorder({ ready: false });
    renderHarness(recorder);

    const button = await talkButton();
    hold(button);
    // Nothing is live yet, so nothing claims to be listening.
    expect(screen.getByRole("button", { name: "hold to talk" })).toBeDefined();
    release(button);
    expect(stops).toHaveLength(0);

    makeReady();

    await waitFor(() => expect(stops).toHaveLength(1));
    expect(requests).toBe(0);
    expect(draftBox().value).toBe("");
  });

  it("sends nothing for a capture with no audio in it", async () => {
    let requests = 0;
    server.use(
      modelsWith("openrouter:openai/whisper-1"),
      http.post("*/api/transcribe", () => {
        requests += 1;
        return HttpResponse.json({ text: "never" });
      }),
    );
    renderHarness(fakeRecorder({ audio: "" }).recorder);

    await holdUntilListening();
    release(screen.getByRole("button"));

    await waitFor(() => expect(screen.queryByText("transcribing…")).toBeNull());
    expect(await talkButton()).toBeDefined();
    expect(draftBox().value).toBe("");
    expect(requests).toBe(0);
  });

  it("leaves the draft alone when nothing was said", async () => {
    server.use(modelsWith("openrouter:openai/whisper-1"), transcribing(""));
    renderHarness(fakeRecorder().recorder, "typed");

    await holdUntilListening();
    release(screen.getByRole("button"));

    expect(await talkButton()).toBeDefined();
    expect(draftBox().value).toBe("typed");
  });

  it("shows a failed transcription inline and clears it on the next hold", async () => {
    server.use(
      modelsWith("openrouter:openai/whisper-1"),
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
    server.use(modelsWith("openrouter:openai/whisper-1"));
    const recorder: Recorder = {
      supported: () => true,
      start: async () => {
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
      modelsWith("openrouter:openai/whisper-1"),
      http.post("*/api/transcribe", async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ text: "once" });
      }),
    );
    const { recorder, stops } = fakeRecorder();
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
    expect(stops).toHaveLength(1);
  });

  it("releases the microphone when unmounted mid-hold", async () => {
    server.use(modelsWith("openrouter:openai/whisper-1"));
    const { recorder, stops } = fakeRecorder();
    const view = renderHarness(recorder);

    await holdUntilListening();
    view.unmount();

    await waitFor(() => expect(stops).toHaveLength(1));
  });
});
