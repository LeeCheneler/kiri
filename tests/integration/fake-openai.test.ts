import { describe, expect, it } from "bun:test";
import {
  FAKE_IMAGE_B64,
  FAKE_USAGE,
  STUB_SUGGESTED_REPLIES,
  SUGGESTED_REPLIES_MARKER,
  fakeOpenAiFetch,
  startFakeOpenAi,
} from "../support/fake-openai.ts";

const post = (body: unknown, init: RequestInit = {}): Request =>
  new Request("http://stub/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
    ...init,
  });

/**
 * Direct coverage for the OpenAI-compatible stub's handler. The AI SDK clients
 * exercise the streaming and error paths through the integration suites; these
 * tests cover the branches only the e2e specs reach — the non-streaming
 * completion, structured message content, mid-stream abort, and the catch-all.
 */
describe("fake openai stub handler", () => {
  it("returns a non-streaming completion that echoes the last user message", async () => {
    const res = await fakeOpenAiFetch(post({ messages: [{ role: "user", content: "hi there" }] }));
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: typeof FAKE_USAGE;
    };

    expect(json.choices[0].message.content).toBe("You said: hi there");
    expect(json.usage).toEqual(FAKE_USAGE);
  });

  it("reads the user text from structured content parts, ignoring non-text", async () => {
    const res = await fakeOpenAiFetch(
      post({
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url" },
              { type: "text" },
              { type: "text", text: "from parts" },
            ],
          },
        ],
      }),
    );
    const json = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(json.choices[0].message.content).toBe("You said: from parts");
  });

  it("suggests its fixed replies when the prompt's assistant text carries the marker", async () => {
    const res = await fakeOpenAiFetch(
      post({
        messages: [
          {
            role: "user",
            content: `Suggest tap-to-send replies…\n\nAssistant message:\nShall I? ${SUGGESTED_REPLIES_MARKER}`,
          },
        ],
      }),
    );
    const json = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(json.choices[0].message.content).toBe(
      ["ENDING: confirmation", ...STUB_SUGGESTED_REPLIES].join("\n"),
    );
  });

  it("abstains from suggesting replies without the marker", async () => {
    const res = await fakeOpenAiFetch(
      post({
        messages: [
          { role: "user", content: "Suggest tap-to-send replies…\n\nAssistant message:\nHello." },
        ],
      }),
    );
    const json = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(json.choices[0].message.content).toBe("ENDING: none");
  });

  it("tidies a draft by upper-casing it under the decisions-then-message shape", async () => {
    const res = await fakeOpenAiFetch(
      post({
        messages: [
          {
            role: "user",
            content: "Tidy the draft message below…\n\nDraft message:\nso um postgres",
          },
        ],
      }),
    );
    const json = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(json.choices[0].message.content).toBe("DECISIONS:\n- stub\nMESSAGE:\nSO UM POSTGRES");
  });

  it("aborting a streamed turn closes it before the final sentinel", async () => {
    const ac = new AbortController();
    const res = await fakeOpenAiFetch(
      post(
        { model: "slow", stream: true, messages: [{ role: "user", content: "hi" }] },
        { signal: ac.signal },
      ),
    );

    const body = res.body;
    if (!body) throw new Error("expected a streamed response body");
    const reader = body.getReader();
    // Pull the opening role chunk so the stub is parked in its lead delay, then
    // abort: the delay must unblock and the stream close without the [DONE] tail.
    await reader.read();
    ac.abort();

    const decoder = new TextDecoder();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += decoder.decode(chunk.value);
    }

    expect(rest).not.toContain("[DONE]");
  });

  it("responds 404 to an unhandled route", async () => {
    const res = await fakeOpenAiFetch(new Request("http://stub/v1/nonsense"));

    expect(res.status).toBe(404);
  });

  it("generates a fixed image from the images endpoint", async () => {
    const res = await fakeOpenAiFetch(
      new Request("http://stub/v1/images/generations", {
        method: "POST",
        body: JSON.stringify({ model: "paint", prompt: "a red panda" }),
      }),
    );
    const json = (await res.json()) as { data: { b64_json: string }[] };

    expect(res.status).toBe(200);
    expect(json.data).toEqual([{ b64_json: FAKE_IMAGE_B64 }]);
  });

  it("fails an image generation whose prompt starts with boom", async () => {
    const res = await fakeOpenAiFetch(
      new Request("http://stub/v1/images/generations", {
        method: "POST",
        body: JSON.stringify({ model: "paint", prompt: "boom please" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("captures image-generation request bodies on the running server", async () => {
    const fake = startFakeOpenAi();
    try {
      await fetch(`${fake.url}/images/generations`, {
        method: "POST",
        body: JSON.stringify({ model: "paint", prompt: "a red panda" }),
      });

      expect(fake.imageRequests).toEqual([{ model: "paint", prompt: "a red panda" }]);
    } finally {
      fake.stop();
    }
  });
});
