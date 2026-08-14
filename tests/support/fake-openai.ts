/**
 * A minimal OpenAI-compatible HTTP stub for tests. Implements just enough of the
 * Chat Completions surface for the AI SDK's `@ai-sdk/openai-compatible` client to
 * drive both `llm:` steps (non-streaming `generateText`) and session turns
 * (streaming `streamText`), plus a `/models` listing for the model picker.
 *
 * Behaviour is selected by the requested model id, so one stub covers every path:
 *
 * - `echo` — a deterministic reply that echoes the last user message, with fixed
 *   token usage. Streams its reply as a handful of deltas, or returns it as a
 *   single completion. The default the model picker lands on.
 * - `slow` — the same reply, but it holds the connection open (a lead delay then
 *   word-by-word) while honouring the request's abort signal, so the in-flight,
 *   cancel, and resume states are observable. Finishes on its own if not aborted.
 * - `boom` — responds with an error so provider/API error paths can be
 *   exercised, both for a streamed turn and a non-streaming step.
 * - `tool` — a scriptable tool caller: a user message of the form
 *   `call:<name> {<json args>}` makes it stream that tool call verbatim, and
 *   once the loop feeds the result back it settles with "All done." — so a
 *   test drives any offered tool with any input, deterministically. Any other
 *   message echoes like `echo`.
 * - `paint` — an image-generation model. Its listing entry reports an image
 *   output modality, and `POST …/images/generations` returns a fixed 1×1 PNG
 *   (or the stub error when the prompt starts with `boom`).
 *
 * Whatever the model, a request whose last user message is kiri's session-title
 * generation prompt is answered with the fixed `STUB_SESSION_TITLE`, so titled
 * sessions carry a stable, assertable label.
 *
 * The same `fakeOpenAiFetch` handler backs both the in-process server the
 * integration tests spin up and the standalone process Playwright boots for e2e.
 */

/** Model ids the stub serves; each selects a behaviour. */
export const FAKE_MODELS = ["echo", "slow", "boom", "tool", "paint"] as const;
export type FakeModel = (typeof FAKE_MODELS)[number];

/** The 1×1 transparent PNG every stub image generation returns, base64-encoded. */
export const FAKE_IMAGE_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Fixed token usage every successful completion reports. */
export const FAKE_USAGE = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } as const;

/** The reply text the stub produces for a given last user message. */
export const fakeReply = (lastUserText: string): string => `You said: ${lastUserText}`;

interface ChatMessage {
  role: string;
  // Chat Completions content is a string for plain text; arrays carry parts.
  content?: string | Array<{ type?: string; text?: string }>;
}

/** A chat-completion request body the stub received — captured for assertions. */
export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
}

/** An image-generation request body the stub received — captured for assertions. */
export interface ImageGenerationRequest {
  model?: string;
  prompt?: string;
  n?: number;
  size?: string;
}

const textOf = (content: ChatMessage["content"]): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
};

const lastUserText = (messages: ChatMessage[]): string => {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last ? textOf(last.content) : "";
};

/** The reply the `tool` model settles with once a tool result has come back. */
export const TOOL_DONE_REPLY = "All done.";

// A `call:<name> {<json>}` directive in the user message, or null when the
// message isn't one. The args ride as the raw JSON string — the consumer (the
// AI SDK) parses them against the tool's schema, not the stub.
const parseToolDirective = (text: string): { name: string; args: string } | null => {
  const match = /^call:(\S+)\s+(\{.*\})\s*$/s.exec(text);
  return match ? { name: match[1] as string, args: match[2] as string } : null;
};

// A timed wait that resolves early — without throwing — if the request aborts,
// so the stub stops promptly when the consumer (kiri) cancels mid-stream.
const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

interface StreamOpts {
  model: string;
  reply: string;
  /** Delay before the first content token (a "thinking" pause). */
  leadMs: number;
  /** Delay between content tokens. */
  perTokenMs: number;
  signal?: AbortSignal;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

// Build an OpenAI-style streamed Chat Completion: a role chunk, content deltas,
// a finish chunk, then a usage-only chunk (mirroring `stream_options.include_usage`,
// which arrives with empty `choices`), terminated by the `[DONE]` sentinel.
const chatCompletionStream = (opts: StreamOpts): ReadableStream<Uint8Array> => {
  const { model, reply, leadMs, perTokenMs, signal } = opts;
  const encoder = new TextEncoder();
  const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: 0, model };

  return new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      const aborted = () => signal?.aborted === true;

      send({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });

      if (leadMs > 0) await delay(leadMs, signal);

      // Split on whitespace but keep the separators so the reassembled text is
      // byte-identical to `reply`.
      for (const token of reply.split(/(\s+)/)) {
        if (aborted()) return controller.close();
        if (perTokenMs > 0) await delay(perTokenMs, signal);
        if (aborted()) return controller.close();
        send({ ...base, choices: [{ index: 0, delta: { content: token }, finish_reason: null }] });
      }

      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ ...base, choices: [], usage: FAKE_USAGE });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

// Build an OpenAI-style streamed tool call: a role chunk, one delta carrying
// the whole call (id, name, and arguments in a single chunk), a
// `finish_reason: "tool_calls"` chunk, then usage and `[DONE]`. The id varies
// with history length so the two calls of a multi-turn test never collide.
const toolCallStream = (
  model: string,
  call: { name: string; args: string },
  callId: string,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: 0, model };
  return new ReadableStream({
    start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      send({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
      send({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: callId,
                  type: "function",
                  function: { name: call.name, arguments: call.args },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      send({ ...base, choices: [], usage: FAKE_USAGE });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

const chatCompletionJson = (model: string, reply: string): Response =>
  Response.json({
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
    usage: FAKE_USAGE,
  });

// Kiri's session-title generation opens its prompt with this phrase; the stub
// answers those calls with a fixed title so e2e session labels are stable
// instead of echoing the whole instruction back as the title.
const TITLE_PROMPT_PREFIX = "Name the conversation";

/** The title the stub answers every session-title generation with. */
export const STUB_SESSION_TITLE = "Kiri e2e session";

// Kiri's suggested-replies generation opens its prompt with this phrase. The
// stub abstains unless the embedded assistant text carries the opt-in marker,
// so chips appear only in tests that ask for them and every other session
// flow stays chip-free.
const SUGGESTED_REPLIES_PROMPT_PREFIX = "Suggest tap-to-send replies";

/** Marker a test embeds in a message to make the stub suggest replies for it. */
export const SUGGESTED_REPLIES_MARKER = "[chips]";

/** The replies the stub suggests when the marker is present. */
export const STUB_SUGGESTED_REPLIES = ["Yes, proceed", "No, hold off"] as const;

// A 400 (not 5xx) so the AI SDK treats it as non-retryable and fails fast,
// rather than burning its retry/backoff budget before surfacing the error.
const errorResponse = (): Response =>
  Response.json(
    { error: { message: "stub provider error", type: "invalid_request_error", code: null } },
    { status: 400 },
  );

// `paint` reports its image output modality the way OpenRouter does, so the
// listing classifier routes it to the image-model picker, not the chat picker.
const modelsListing = (): Response =>
  Response.json({
    object: "list",
    data: FAKE_MODELS.map((id) => ({
      id,
      object: "model",
      owned_by: "kiri-test",
      ...(id === "paint" ? { architecture: { output_modalities: ["image"] } } : {}),
    })),
  });

/**
 * The stub's request handler. Routes `GET …/models` and `POST …/chat/completions`
 * (both streaming and non-streaming), keyed off the requested model id. Anything
 * else is a 404. Honours `req.signal` so an aborted turn stops the stream.
 */
export const fakeOpenAiFetch = async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);

  if (req.method === "GET" && pathname.endsWith("/models")) return modelsListing();

  if (req.method === "POST" && pathname.endsWith("/images/generations")) {
    const body = (await req.json()) as ImageGenerationRequest;
    if ((body.prompt ?? "").startsWith("boom")) return errorResponse();
    return Response.json({ created: 0, data: [{ b64_json: FAKE_IMAGE_B64 }] });
  }

  if (req.method === "POST" && pathname.endsWith("/chat/completions")) {
    const body = (await req.json()) as {
      model?: string;
      messages?: ChatMessage[];
      stream?: boolean;
    };
    const model = body.model ?? "echo";
    const messages = body.messages ?? [];
    const userText = lastUserText(messages);
    let reply = fakeReply(userText);
    if (userText.startsWith(TITLE_PROMPT_PREFIX)) reply = STUB_SESSION_TITLE;
    if (userText.startsWith(SUGGESTED_REPLIES_PROMPT_PREFIX)) {
      reply = userText.includes(SUGGESTED_REPLIES_MARKER)
        ? ["ENDING: confirmation", ...STUB_SUGGESTED_REPLIES].join("\n")
        : "ENDING: none";
    }

    if (model === "boom") return errorResponse();

    if (model === "tool") {
      const directive = parseToolDirective(lastUserText(messages));
      const toolRanAlready = messages.at(-1)?.role === "tool";
      if (directive && !toolRanAlready && body.stream) {
        return new Response(toolCallStream(model, directive, `call-stub-${messages.length}`), {
          headers: SSE_HEADERS,
        });
      }
      if (toolRanAlready) reply = TOOL_DONE_REPLY;
    }

    if (body.stream) {
      const timing =
        model === "slow" ? { leadMs: 1500, perTokenMs: 300 } : { leadMs: 0, perTokenMs: 0 };
      return new Response(chatCompletionStream({ model, reply, signal: req.signal, ...timing }), {
        headers: SSE_HEADERS,
      });
    }

    return chatCompletionJson(model, reply);
  }

  return Response.json(
    { error: { message: `unhandled ${req.method} ${pathname}` } },
    { status: 404 },
  );
};

/** A running stub instance: its base URL (with the `/v1` suffix) and a stop handle. */
export interface FakeOpenAi {
  /** Base URL to put in `kiri.yaml` `base_url` — includes `/v1`. */
  url: string;
  port: number;
  /** Chat-completion request bodies the stub received, in order — for asserting what kiri sent the model. */
  requests: ChatCompletionRequest[];
  /** Image-generation request bodies the stub received, in order. */
  imageRequests: ImageGenerationRequest[];
  stop(): void;
}

/**
 * Start the stub on an ephemeral port (or `port` if given) and return its base
 * URL. Used by integration tests; e2e boots `fake-openai-server.ts` as its own
 * process instead. Records each chat-completion request body on `requests` so a
 * test can assert what kiri sent — notably the composed system prompt.
 */
export const startFakeOpenAi = (port = 0): FakeOpenAi => {
  const requests: ChatCompletionRequest[] = [];
  const imageRequests: ImageGenerationRequest[] = [];
  const server = Bun.serve({
    port,
    fetch: async (req) => {
      // Capture request bodies; clone first so the handler can still read the
      // stream.
      const { pathname } = new URL(req.url);
      if (req.method === "POST" && pathname.endsWith("/chat/completions")) {
        requests.push((await req.clone().json()) as ChatCompletionRequest);
      }
      if (req.method === "POST" && pathname.endsWith("/images/generations")) {
        imageRequests.push((await req.clone().json()) as ImageGenerationRequest);
      }
      return fakeOpenAiFetch(req);
    },
  });
  const actualPort = server.port ?? port;
  return {
    url: `http://127.0.0.1:${actualPort}/v1`,
    port: actualPort,
    requests,
    imageRequests,
    stop: () => server.stop(true),
  };
};
