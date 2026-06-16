import { describe, expect, it } from "bun:test";
import { FAKE_USAGE, fakeOpenAiFetch } from "../support/fake-openai.ts";

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
});
