import { describe, expect, it } from "bun:test";
import { generateImage } from "ai";
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

  it("lists models across configured providers via listModels", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "claude-haiku-4-5" }] }),
      ),
    );
    const clients = createLlmClients(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    const result = await clients.listModels();

    expect(result.models).toEqual([
      { id: "anthropic:claude-haiku-4-5", provider: "anthropic", output: "text" },
    ]);
    expect(result.failures).toEqual([]);
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
