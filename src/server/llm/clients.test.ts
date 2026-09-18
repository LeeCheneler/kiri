import { describe, expect, it, spyOn } from "bun:test";
import { generateImage, generateText, experimental_transcribe as transcribe } from "ai";
import { http, HttpResponse, delay } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { createLlmClients, generateLlmText } from "./clients.ts";
import type { LlmProvider, LlmProviderRegistry } from "./index.ts";
import { createLlmProviderRegistry } from "./registry.ts";

const registryWith = (...providers: LlmProvider[]): LlmProviderRegistry => {
  const registry = createLlmProviderRegistry();
  registry.replace(new Map(providers.map((provider) => [provider.name, provider])));
  return registry;
};

const anthropic: LlmProvider = {
  name: "anthropic",
  type: "anthropic",
  apiKeyEnv: "ANTHROPIC_API_KEY",
};
const openai: LlmProvider = { name: "openai", type: "openai", apiKeyEnv: "OPENAI_API_KEY" };
const local: LlmProvider = {
  name: "local",
  type: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
};

// A 1x1 transparent PNG, so the SDK's media-type sniffing sees real image bytes.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A bare RIFF/WAVE header, so the SDK's media-type sniffing sees real audio
// bytes and posts the file as `audio/wav`.
const TINY_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

const anthropicMessages = (text: string, usage = { input_tokens: 11, output_tokens: 22 }) =>
  http.post("https://api.anthropic.com/v1/messages", () =>
    HttpResponse.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
    }),
  );

const chatCompletions = (
  url: string,
  text: string,
  usage = { prompt_tokens: 7, completion_tokens: 13, total_tokens: 20 },
) =>
  http.post(url, () =>
    HttpResponse.json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage,
    }),
  );

describe("llm clients", () => {
  it("constructs and completes an anthropic provider", async () => {
    server.use(anthropicMessages("hi from claude"));
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    const result = await generateLlmText({
      model: clients.resolveModel("anthropic:claude-haiku-4-5"),
      prompt: "hello",
    });

    expect(result.text).toBe("hi from claude");
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(22);
  });

  it("constructs an openai provider and calls the chat completions endpoint", async () => {
    server.use(chatCompletions("https://api.openai.com/v1/chat/completions", "hi from openai"));
    const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    const result = await generateLlmText({
      model: clients.resolveModel("openai:gpt-4o-mini"),
      prompt: "hello",
    });

    expect(result.text).toBe("hi from openai");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 13, totalTokens: 20 });
  });

  it("asks OpenRouter for the free document parser only where the model lacks native support", async () => {
    const openrouter: LlmProvider = {
      name: "openrouter",
      type: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    };
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get("https://openrouter.ai/api/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "native/reader", architecture: { input_modalities: ["text", "file"] } },
            { id: "plain/chat", architecture: { input_modalities: ["text"] } },
          ],
        }),
      ),
      http.post("https://openrouter.ai/api/v1/chat/completions", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
        });
      }),
    );
    const clients = createLlmClients(registryWith(openrouter), { OPENROUTER_API_KEY: "sk-test" });
    const pdfPrompt = [
      {
        role: "user" as const,
        content: [
          { type: "file" as const, mediaType: "application/pdf", filename: "a.pdf", data: "AQI=" },
          { type: "text" as const, text: "Summarise" },
        ],
      },
    ];

    await generateText({
      model: clients.resolveModel("openrouter:plain/chat"),
      messages: pdfPrompt,
    });
    await generateText({
      model: clients.resolveModel("openrouter:native/reader"),
      messages: pdfPrompt,
    });
    await generateText({ model: clients.resolveModel("openrouter:plain/chat"), prompt: "hello" });

    expect(bodies.map((body) => body.plugins)).toEqual([
      [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }],
      undefined,
      undefined,
    ]);
  });

  it("constructs and completes an openai-compatible provider at its base_url", async () => {
    server.use(chatCompletions("http://localhost:1234/v1/chat/completions", "hi from local"));
    const clients = createLlmClients(registryWith(local), {});

    const result = await generateLlmText({
      model: clients.resolveModel("local:some-model"),
      prompt: "hello",
    });

    expect(result.text).toBe("hi from local");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 13, totalTokens: 20 });
  });

  it("resolves an openai-codex provider to the Codex subscription model", () => {
    const codex: LlmProvider = { name: "chatgpt", type: "openai-codex" };
    const model = createLlmClients(registryWith(codex), {}).resolveModel("chatgpt:gpt-5.2");

    // The provider id is what routes a one-off call down the Codex text path.
    expect(typeof model === "string" ? model : model.provider).toBe("openai-codex");
  });

  it("resolves an openai image model against the images endpoint with the key", async () => {
    let headers: Headers | undefined;
    server.use(
      http.post("https://api.openai.com/v1/images/generations", ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ created: 0, data: [{ b64_json: TINY_PNG_B64 }] });
      }),
    );
    const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    const { image } = await generateImage({
      model: clients.resolveImageModel("openai:gpt-image-1"),
      prompt: "a red panda",
    });

    expect(image.base64).toBe(TINY_PNG_B64);
    expect(headers?.get("authorization")).toBe("Bearer sk-test");
  });

  it("resolves an openai-compatible image model against its base_url images endpoint", async () => {
    server.use(
      http.post("http://localhost:1234/v1/images/generations", () =>
        HttpResponse.json({ created: 0, data: [{ b64_json: TINY_PNG_B64 }] }),
      ),
    );
    const clients = createLlmClients(registryWith(local), {});

    const { image } = await generateImage({
      model: clients.resolveImageModel("local:flux"),
      prompt: "a red panda",
    });

    expect(image.base64).toBe(TINY_PNG_B64);
  });

  it("refuses an image model on an anthropic provider", () => {
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(() => clients.resolveImageModel("anthropic:claude")).toThrow(
      /offers no image generation/,
    );
  });

  it("rejects an image model id whose provider is not configured", () => {
    const clients = createLlmClients(registryWith(openai), {});

    expect(() => clients.resolveImageModel("ghost:model")).toThrow(/unknown llm provider "ghost"/);
  });

  it("resolves an openai transcription model against the transcriptions endpoint with the key", async () => {
    let headers: Headers | undefined;
    let form: FormData | undefined;
    server.use(
      http.post("https://api.openai.com/v1/audio/transcriptions", async ({ request }) => {
        headers = request.headers;
        form = await request.formData();
        return HttpResponse.json({ text: "hello there" });
      }),
    );
    const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    const { text } = await transcribe({
      model: clients.resolveTranscriptionModel("openai:whisper-1"),
      audio: TINY_WAV,
    });

    expect(text).toBe("hello there");
    expect(headers?.get("authorization")).toBe("Bearer sk-test");
    expect(form?.get("model")).toBe("whisper-1");
    expect((form?.get("file") as File).name).toBe("audio.wav");
  });

  it("resolves an openai-compatible transcription model against its base_url transcriptions endpoint", async () => {
    let form: FormData | undefined;
    server.use(
      http.post("http://localhost:1234/v1/audio/transcriptions", async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json({ text: "hello from local" });
      }),
    );
    const clients = createLlmClients(registryWith(local), {});

    const { text } = await transcribe({
      model: clients.resolveTranscriptionModel("local:openai/whisper-1"),
      audio: TINY_WAV,
    });

    expect(text).toBe("hello from local");
    expect(form?.get("model")).toBe("openai/whisper-1");
  });

  it("refuses a transcription model on an anthropic provider", () => {
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(() => clients.resolveTranscriptionModel("anthropic:claude")).toThrow(
      /offers no transcription/,
    );
  });

  it("rejects a transcription model id whose provider is not configured", () => {
    const clients = createLlmClients(registryWith(openai), {});

    expect(() => clients.resolveTranscriptionModel("ghost:model")).toThrow(
      /unknown llm provider "ghost"/,
    );
  });

  it("lists models across configured providers via listModels", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-haiku-4-5" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    const result = await clients.listModels();

    expect(result.models).toEqual([
      {
        id: "anthropic:claude-haiku-4-5",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        listed: true,
        model: { output: "text", reasoning: true },
        transport: { type: "anthropic", endpoint: "anthropic", documents: ["application/pdf"] },
        parser: { documents: [] },
      },
    ]);
    expect(result.failures).toEqual([]);
  });

  it("collects a provider's listing failure without failing the others", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "ok", context_length: 100 }] }),
      ),
      http.get(
        "https://api.openai.com/v1/models",
        () => new HttpResponse(null, { status: 500, statusText: "Internal Server Error" }),
      ),
    );
    const clients = createLlmClients(registryWith(openai, local), { OPENAI_API_KEY: "sk-test" });

    const result = await clients.listModels();

    expect(result.models.map((model) => model.id)).toEqual(["local:ok"]);
    expect(result.failures).toEqual([{ provider: "openai", reason: "500 Internal Server Error" }]);
  });

  it("lists nothing when no providers are configured", async () => {
    expect(await createLlmClients(registryWith(), {}).listModels()).toEqual({
      models: [],
      failures: [],
    });
  });

  it("answers for a model without waiting on an unrelated provider's listing", async () => {
    const release = Promise.withResolvers<void>();
    server.use(
      http.get("http://localhost:1234/v1/models", async () => {
        await release.promise;
        return HttpResponse.json({ data: [] });
      }),
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-opus-4-8", max_input_tokens: 100 }] }),
      ),
    );
    const clients = createLlmClients(registryWith(local, anthropic), {
      ANTHROPIC_API_KEY: "sk-test",
    });
    const hung = clients.contextWindowFor("local:model");

    expect(await clients.contextWindowFor("anthropic:claude-opus-4-8")).toBe(100);
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-8", "high")).toEqual({
      anthropic: { effort: "high" },
    });

    release.resolve();
    expect(await hung).toBeUndefined();
  });

  it("maps effort to anthropic's effort parameter on a modern claude model", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-opus-4-8" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    // The full ladder passes through untouched — no thinking config is set,
    // so the model keeps its own default reasoning behaviour.
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-8", effort)).toEqual({
        anthropic: { effort },
      });
    }
  });

  it("clamps anthropic effort to what each claude generation accepts", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "claude-opus-4-6" },
            { id: "claude-opus-4-5" },
            { id: "claude-sonnet-4-5" },
            { id: "claude-3-7-sonnet-latest" },
            { id: "claude-opus-4-20250514" },
            { id: "claude-fable-5" },
          ],
        }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    // The 4.6 generation has no xhigh (clamped to high) but does take max.
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-6", "xhigh")).toEqual({
      anthropic: { effort: "high" },
    });
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-6", "max")).toEqual({
      anthropic: { effort: "max" },
    });
    // Opus 4.5 takes low/medium/high only.
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-5", "xhigh")).toEqual({
      anthropic: { effort: "high" },
    });
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-5", "max")).toEqual({
      anthropic: { effort: "high" },
    });
    expect(await clients.reasoningOptionsFor("anthropic:claude-opus-4-5", "medium")).toEqual({
      anthropic: { effort: "medium" },
    });
    // Pre-effort thinking generations get no parameters at all.
    expect(
      await clients.reasoningOptionsFor("anthropic:claude-sonnet-4-5", "high"),
    ).toBeUndefined();
    expect(
      await clients.reasoningOptionsFor("anthropic:claude-3-7-sonnet-latest", "max"),
    ).toBeUndefined();
    // A dated 4.0-generation id reads as major 4 with no minor — the date
    // suffix is not a minor version — so it gets no parameters either.
    expect(
      await clients.reasoningOptionsFor("anthropic:claude-opus-4-20250514", "high"),
    ).toBeUndefined();
    // An id outside the recognised family-version shape is treated as modern.
    expect(await clients.reasoningOptionsFor("anthropic:claude-fable-5", "xhigh")).toEqual({
      anthropic: { effort: "xhigh" },
    });
  });

  it("maps effort to an openai reasoning_effort, sending max as xhigh", async () => {
    server.use(
      http.get("https://api.openai.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "gpt-5.2" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(await clients.reasoningOptionsFor("openai:gpt-5.2", "low")).toEqual({
      openai: { reasoningEffort: "low" },
    });
    // xhigh passes through as requested — a model that rejects it surfaces a
    // provider error like any other, never a silent clamp.
    expect(await clients.reasoningOptionsFor("openai:gpt-5.2", "xhigh")).toEqual({
      openai: { reasoningEffort: "xhigh" },
    });
    // The openai-style enum has no max, so kiri's max sends its top.
    expect(await clients.reasoningOptionsFor("openai:gpt-5.2", "max")).toEqual({
      openai: { reasoningEffort: "xhigh" },
    });
  });

  it("keys an openai-compatible provider's reasoning options by its configured name", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [{ id: "some-deep-model", supported_parameters: ["reasoning"] }],
        }),
      ),
    );
    const clients = createLlmClients(registryWith(local), {});

    expect(await clients.reasoningOptionsFor("local:some-deep-model", "high")).toEqual({
      local: { reasoningEffort: "high" },
    });
  });

  it("returns undefined from reasoningOptionsFor for models without reasoning support", async () => {
    server.use(
      http.get("https://api.openai.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "gpt-4o" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    // A listed non-reasoning model, and a model that isn't listed at all —
    // neither ever gets reasoning parameters sent blind.
    expect(await clients.reasoningOptionsFor("openai:gpt-4o", "high")).toBeUndefined();
    expect(await clients.reasoningOptionsFor("openai:ghost", "high")).toBeUndefined();
  });

  it("returns a model's context window via contextWindowFor", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-haiku-4-5", max_input_tokens: 200000 }] }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(await clients.contextWindowFor("anthropic:claude-haiku-4-5")).toBe(200000);
  });

  it("reports an unknown window as undefined from contextWindowFor", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-haiku-4-5" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    // Listed but the provider reports no window, and a model that isn't listed
    // at all — both read as "unknown" rather than throwing.
    expect(await clients.contextWindowFor("anthropic:claude-haiku-4-5")).toBeUndefined();
    expect(await clients.contextWindowFor("anthropic:ghost")).toBeUndefined();
  });

  it("caches the listing so repeated contextWindowFor lookups don't refetch", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.anthropic.com/v1/models", () => {
        calls += 1;
        return HttpResponse.json({ data: [{ id: "claude-haiku-4-5", max_input_tokens: 100 }] });
      }),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(await clients.contextWindowFor("anthropic:claude-haiku-4-5")).toBe(100);
    expect(await clients.contextWindowFor("anthropic:claude-haiku-4-5")).toBe(100);
    expect(calls).toBe(1);
  });

  it("refreshes cached metadata immediately when an endpoint changes under the same provider name", async () => {
    const calls = { old: 0, next: 0 };
    server.use(
      http.get("http://localhost:1234/v1/models", () => {
        calls.old++;
        return HttpResponse.json({
          data: [{ id: "model", context_length: 100, supported_parameters: ["reasoning"] }],
        });
      }),
      http.get("http://localhost:4321/v1/models", () => {
        calls.next++;
        return HttpResponse.json({ data: [{ id: "model", context_length: 200 }] });
      }),
    );
    const registry = registryWith(local);
    const clients = createLlmClients(registry, {});
    expect(await clients.contextWindowFor("local:model")).toBe(100);
    expect(await clients.reasoningOptionsFor("local:model", "high")).toEqual({
      local: { reasoningEffort: "high" },
    });
    registry.replace(new Map([["local", { ...local, baseUrl: "http://localhost:4321/v1" }]]));
    expect(await clients.contextWindowFor("local:model")).toBe(200);
    expect(await clients.reasoningOptionsFor("local:model", "high")).toBeUndefined();
    expect(calls).toEqual({ old: 1, next: 1 });
    // The picker discovers afresh on every listing request, and execution
    // then reads what it was shown rather than discovering again.
    expect((await clients.listModels()).models[0]?.model.contextWindow).toBe(200);
    await clients.listModels();
    expect(calls).toEqual({ old: 1, next: 3 });
    expect(await clients.contextWindowFor("local:model")).toBe(200);
    expect(calls.next).toBe(3);
  });

  for (const removed of [false, true]) {
    it(`isolates an older in-flight listing after provider ${removed ? "removal" : "replacement"}`, async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const calls = { old: 0, next: 0 };
      server.use(
        http.get("http://localhost:1234/v1/models", async () => {
          calls.old++;
          started.resolve();
          await release.promise;
          return HttpResponse.json({
            data: [{ id: "gpt-5.2", context_length: 100, supported_parameters: ["reasoning"] }],
          });
        }),
        http.get("https://api.openai.com/v1/models", () => {
          calls.next++;
          return HttpResponse.json({ data: [{ id: "gpt-5.2", context_length: 200 }] });
        }),
      );
      const registry = registryWith(local);
      const clients = createLlmClients(registry, { OPENAI_API_KEY: "sk-test" });
      const oldContext = clients.contextWindowFor("local:gpt-5.2");
      const oldReasoning = clients.reasoningOptionsFor("local:gpt-5.2", "high");
      await started.promise;
      registry.replace(removed ? new Map() : new Map([["local", { ...openai, name: "local" }]]));
      const nextContext = removed ? undefined : 200;
      const nextReasoning = removed ? undefined : { openai: { reasoningEffort: "high" } };
      expect(await clients.contextWindowFor("local:gpt-5.2")).toEqual(nextContext);
      expect(await clients.reasoningOptionsFor("local:gpt-5.2", "high")).toEqual(nextReasoning);
      release.resolve();
      expect(await oldContext).toBe(100);
      // Finishing the old lookup must not combine old metadata with the new provider type.
      expect(await oldReasoning).toEqual({ local: { reasoningEffort: "high" } });
      expect(await clients.contextWindowFor("local:gpt-5.2")).toEqual(nextContext);
      expect(await clients.reasoningOptionsFor("local:gpt-5.2", "high")).toEqual(nextReasoning);
      expect(calls).toEqual({ old: 1, next: removed ? 0 : 1 });
      if (removed)
        expect(() => clients.resolveModel("local:gpt-5.2")).toThrow("unknown llm provider");
    });
  }

  it("still expires metadata after five minutes within one revision", async () => {
    let calls = 0;
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      server.use(
        http.get("http://localhost:1234/v1/models", () => {
          calls++;
          return HttpResponse.json({ data: [{ id: "model", context_length: calls * 100 }] });
        }),
      );
      const clients = createLlmClients(registryWith(local), {});
      expect(await clients.contextWindowFor("local:model")).toBe(100);
      now += 5 * 60_000 - 1;
      expect(await clients.contextWindowFor("local:model")).toBe(100);
      now++;
      expect(await clients.contextWindowFor("local:model")).toBe(200);
      expect(calls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps a resolved model's document metadata on its original endpoint across reload and expiry", async () => {
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const calls = { old: 0, next: 0 };
      const bodies: { endpoint: string; plugins: unknown }[] = [];
      for (const endpoint of ["old", "next"] as const) {
        server.use(
          http.get(`https://openrouter.ai/${endpoint}/models`, () => {
            calls[endpoint]++;
            return HttpResponse.json({
              data: [
                {
                  id: "reader",
                  architecture: {
                    input_modalities: endpoint === "old" ? ["text", "file"] : ["text"],
                  },
                },
              ],
            });
          }),
          http.post(`https://openrouter.ai/${endpoint}/chat/completions`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            bodies.push({ endpoint, plugins: body.plugins });
            return HttpResponse.json({
              id: "chatcmpl-1",
              object: "chat.completion",
              created: 0,
              model: "reader",
              choices: [
                { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
              ],
            });
          }),
        );
      }
      const provider: LlmProvider = {
        name: "router",
        type: "openai-compatible",
        baseUrl: "https://openrouter.ai/old",
      };
      const registry = registryWith(provider);
      const clients = createLlmClients(registry, {});
      const oldModel = clients.resolveModel("router:reader");
      registry.replace(
        new Map([["router", { ...provider, baseUrl: "https://openrouter.ai/next" }]]),
      );
      const newModel = clients.resolveModel("router:reader");
      const messages = [
        {
          role: "user" as const,
          content: [{ type: "file" as const, mediaType: "application/pdf", data: "AQI=" }],
        },
      ];
      await generateText({ model: newModel, messages });
      // The old model's first metadata lookup happens only after the replacement was cached.
      await generateText({ model: oldModel, messages });
      registry.replace(new Map());
      now += 5 * 60_000;
      await generateText({ model: oldModel, messages });
      expect(bodies).toEqual([
        { endpoint: "next", plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] },
        { endpoint: "old", plugins: undefined },
        { endpoint: "old", plugins: undefined },
      ]);
      expect(calls).toEqual({ old: 2, next: 1 });
      expect(await clients.contextWindowFor("router:reader")).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it("resolves and completes in one call via the generateText method", async () => {
    server.use(anthropicMessages("hi from claude"));
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    const result = await clients.generateText({
      model: "anthropic:claude-haiku-4-5",
      prompt: "hello",
    });

    expect(result.text).toBe("hi from claude");
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(22);
  });

  it.each([false, true])(
    "passes utility system instructions and native images (images: %s)",
    async (withImages) => {
      let body: unknown;
      server.use(
        http.post("https://api.openai.com/v1/chat/completions", async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 0,
            model: "gpt-4o-mini",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Summary" },
                finish_reason: "stop",
              },
            ],
          });
        }),
      );
      const clients = createLlmClients(registryWith(openai), { OPENAI_API_KEY: "sk-test" });
      await clients.generateText({
        model: "openai:gpt-4o-mini",
        system: "Summarise only",
        prompt: "Conversation data",
        ...(withImages
          ? { images: [{ type: "image" as const, image: TINY_PNG_B64, mediaType: "image/png" }] }
          : {}),
      });
      expect(body).toMatchObject({
        messages: [
          { role: "system", content: "Summarise only" },
          {
            role: "user",
            content: withImages
              ? [
                  { type: "text", text: "Conversation data" },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` },
                  },
                ]
              : "Conversation data",
          },
        ],
      });
    },
  );

  it("surfaces a resolution error from generateText as a rejection, not a throw", async () => {
    const clients = createLlmClients(registryWith(anthropic), {});

    await expect(clients.generateText({ model: "openai:gpt-4o", prompt: "p" })).rejects.toThrow(
      /unknown llm provider "openai"/,
    );
  });

  it("throws for an unknown provider prefix, listing the configured providers", () => {
    const clients = createLlmClients(registryWith(anthropic, local), {});

    expect(() => clients.resolveModel("openai:gpt-4o")).toThrow(/unknown llm provider "openai"/);
    expect(() => clients.resolveModel("openai:gpt-4o")).toThrow(/anthropic, local/);
  });

  it("throws for an id that is not in provider:model form", () => {
    const clients = createLlmClients(registryWith(anthropic), {});

    expect(() => clients.resolveModel("claude-haiku-4-5")).toThrow(/provider:model/);
    expect(() => clients.resolveModel("anthropic:")).toThrow(/provider:model/);
  });

  it("propagates an abort signal to cancel the in-flight call", async () => {
    server.use(
      http.post("https://api.anthropic.com/v1/messages", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });
    const controller = new AbortController();

    const promise = generateLlmText({
      model: clients.resolveModel("anthropic:claude-haiku-4-5"),
      prompt: "hello",
      abortSignal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it("does not leak api key material in a bubbled provider error", async () => {
    const secret = "sk-ant-super-secret-value";
    server.use(
      http.post("https://api.anthropic.com/v1/messages", () =>
        HttpResponse.json(
          { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
          { status: 401 },
        ),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: secret });

    try {
      await generateLlmText({
        model: clients.resolveModel("anthropic:claude-haiku-4-5"),
        prompt: "hello",
      });
      throw new Error("expected generateLlmText to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const serialised = JSON.stringify(err, Object.getOwnPropertyNames(err as Error));
      expect(`${String(err)}${serialised}`).not.toContain(secret);
    }
  });
});
