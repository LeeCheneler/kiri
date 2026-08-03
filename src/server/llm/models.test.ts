import { beforeEach, describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import type { LlmProvider, LlmProviderRegistry } from "./index.ts";
import { listLlmModels } from "./models.ts";
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

const modelList = (url: string, ids: unknown[]) =>
  http.get(url, () => HttpResponse.json({ data: ids.map((id) => ({ id })) }));

describe("listLlmModels", () => {
  // The openai-compatible context probe targets LM Studio's native endpoint;
  // default it to absent so a bare listing never reaches a real localhost:1234.
  // LM Studio tests override this.
  beforeEach(() => {
    server.use(
      http.get(
        "http://localhost:1234/api/v0/models",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
  });

  it("lists an anthropic provider's models with the version and key headers", async () => {
    let headers: Headers | undefined;
    server.use(
      http.get("https://api.anthropic.com/v1/models", ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ data: [{ id: "claude-haiku-4-5" }] });
      }),
    );

    const result = await listLlmModels(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "anthropic:claude-haiku-4-5", provider: "anthropic", output: "text", reasoning: true },
    ]);
    expect(result.failures).toEqual([]);
    expect(headers?.get("x-api-key")).toBe("sk-test");
    expect(headers?.get("anthropic-version")).toBe("2023-06-01");
  });

  it("lists an openai provider's models with a bearer token", async () => {
    let headers: Headers | undefined;
    server.use(
      http.get("https://api.openai.com/v1/models", ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ data: [{ id: "gpt-4o-mini" }] });
      }),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:gpt-4o-mini", provider: "openai", output: "text", reasoning: false },
    ]);
    expect(headers?.get("authorization")).toBe("Bearer sk-test");
  });

  it("lists an openai-compatible provider at its base_url without an auth header", async () => {
    let headers: Headers | undefined;
    server.use(
      http.get("http://localhost:1234/v1/models", ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ data: [{ id: "some-model" }] });
      }),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:some-model", provider: "local", output: "text", reasoning: false },
    ]);
    expect(headers?.get("authorization")).toBeNull();
  });

  it("normalises a trailing slash on the configured base_url", async () => {
    server.use(modelList("http://localhost:1234/v1/models", ["m1"]));
    const trailing: LlmProvider = { ...local, baseUrl: "http://localhost:1234/v1/" };

    const result = await listLlmModels(registryWith(trailing), {});

    expect(result.models).toEqual([
      { id: "local:m1", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("aggregates and flattens models across every configured provider", async () => {
    server.use(
      modelList("https://api.anthropic.com/v1/models", ["claude-haiku-4-5"]),
      modelList("http://localhost:1234/v1/models", ["a", "b"]),
    );

    const result = await listLlmModels(registryWith(anthropic, local), {
      ANTHROPIC_API_KEY: "sk-test",
    });

    expect(result.models).toEqual([
      { id: "anthropic:claude-haiku-4-5", provider: "anthropic", output: "text", reasoning: true },
      { id: "local:a", provider: "local", output: "text", reasoning: false },
      { id: "local:b", provider: "local", output: "text", reasoning: false },
    ]);
    expect(result.failures).toEqual([]);
  });

  it("collects a provider failure without failing the other providers", async () => {
    server.use(
      modelList("http://localhost:1234/v1/models", ["ok"]),
      http.get(
        "https://api.openai.com/v1/models",
        () => new HttpResponse(null, { status: 500, statusText: "Internal Server Error" }),
      ),
    );

    const result = await listLlmModels(registryWith(openai, local), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "local:ok", provider: "local", output: "text", reasoning: false },
    ]);
    expect(result.failures).toEqual([{ provider: "openai", reason: "500 Internal Server Error" }]);
  });

  it("filters out non-string model ids", async () => {
    server.use(modelList("https://api.openai.com/v1/models", ["gpt-4o", 123, null]));

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:gpt-4o", provider: "openai", output: "text", reasoning: false },
    ]);
  });

  it("treats a response with no data array as zero models", async () => {
    server.use(http.get("https://api.openai.com/v1/models", () => HttpResponse.json({})));

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result).toEqual({ models: [], failures: [] });
  });

  it("returns empty results when no providers are configured", async () => {
    expect(await listLlmModels(registryWith(), {})).toEqual({ models: [], failures: [] });
  });

  it("does not leak api key material in a failure reason", async () => {
    const secret = "sk-ant-super-secret-value";
    server.use(
      http.get(
        "https://api.anthropic.com/v1/models",
        () => new HttpResponse(null, { status: 401, statusText: "Unauthorized" }),
      ),
    );

    const result = await listLlmModels(registryWith(anthropic), { ANTHROPIC_API_KEY: secret });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).not.toContain(secret);
  });

  it("reads context window and output cap from an anthropic-style listing", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({
          data: [{ id: "claude-opus-4-8", max_input_tokens: 1000000, max_tokens: 128000 }],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      {
        id: "anthropic:claude-opus-4-8",
        provider: "anthropic",
        contextWindow: 1000000,
        outputLimit: 128000,
        output: "text",
        reasoning: true,
      },
    ]);
  });

  it("prefers an openai-compatible entry's served limit over its theoretical max", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            {
              id: "anthropic/claude",
              context_length: 200000,
              top_provider: { context_length: 64000, max_completion_tokens: 8192 },
            },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:anthropic/claude",
        provider: "local",
        contextWindow: 64000,
        outputLimit: 8192,
        output: "text",
        reasoning: true,
      },
    ]);
  });

  it("reads a vLLM-style max_model_len", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "qwen", max_model_len: 32768 }] }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:qwen",
        provider: "local",
        contextWindow: 32768,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("reads a deepinfra-style metadata.context_length without treating metadata.max_tokens as an output cap", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            {
              id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
              metadata: { context_length: 131072, max_tokens: 131072 },
            },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:meta-llama/Llama-3.3-70B-Instruct-Turbo",
        provider: "local",
        contextWindow: 131072,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("ignores non-positive or non-numeric limit fields", async () => {
    server.use(
      http.get("https://api.openai.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "gpt-x", max_input_tokens: 0, context_length: "nope" }] }),
      ),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:gpt-x", provider: "openai", output: "text", reasoning: false },
    ]);
  });

  it("classifies models as image-output from their reported modalities", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            {
              id: "google/gemini-image",
              architecture: { output_modalities: ["image", "text"] },
              context_length: 32768,
            },
            {
              id: "google/gemini",
              architecture: { output_modalities: ["text"] },
              context_length: 32768,
            },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:google/gemini-image",
        provider: "local",
        contextWindow: 32768,
        output: "image",
        reasoning: false,
      },
      {
        id: "local:google/gemini",
        provider: "local",
        contextWindow: 32768,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("omits models that produce neither text nor images", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            // A music model reports text alongside audio — it still can't hold
            // a chat session, so reported text alone must not qualify it.
            { id: "google/lyria", architecture: { output_modalities: ["text", "audio"] } },
            { id: "openai/sora", architecture: { output_modalities: ["video"] } },
            {
              id: "google/gemma",
              architecture: { output_modalities: ["text"] },
              context_length: 8192,
            },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:google/gemma",
        provider: "local",
        contextWindow: 8192,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("classifies the arrow modality form when output_modalities is absent", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "chatty", architecture: { modality: "text+image->text" } },
            { id: "painter", architecture: { modality: "text->image" } },
            // No arrow — unparseable, so the id fallback classifies it.
            { id: "mystery", architecture: { modality: "multimodal" } },
            { id: "singer", architecture: { modality: "text->audio" } },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      // The arrow's left-hand side answers image input: chatty takes
      // text+image, painter takes text only.
      { id: "local:chatty", provider: "local", output: "text", imageInput: true, reasoning: false },
      {
        id: "local:painter",
        provider: "local",
        output: "image",
        imageInput: false,
        reasoning: false,
      },
      { id: "local:mystery", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("classifies deepinfra-style metadata tags", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "flux", metadata: { tags: ["image-gen"] } },
            { id: "glm", metadata: { tags: ["chat", "reasoning"] } },
            { id: "qwen-vl", metadata: { tags: ["vlm", "vision"] } },
            { id: "qwen-embedding", metadata: { tags: ["embed"] } },
            { id: "qwen-speech", metadata: { tags: ["tts"] } },
            // Only unrecognised tags — no signal, so the id fallback applies.
            { id: "thinker", metadata: { tags: ["reasoning"] } },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:flux", provider: "local", output: "image", reasoning: false },
      { id: "local:glm", provider: "local", output: "text", reasoning: false },
      // The "vlm" tag marks a vision chat model; a plain "chat" tag says
      // nothing about input, so glm stays unknown rather than false.
      {
        id: "local:qwen-vl",
        provider: "local",
        output: "text",
        imageInput: true,
        reasoning: false,
      },
      { id: "local:thinker", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("classifies together-style type tags, ignoring unrecognised values", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "painter", type: "image" },
            { id: "chatty", type: "chat" },
            { id: "vectors", type: "embedding" },
            // Anthropic marks every entry `type: "model"` — no signal at all.
            { id: "claude-haiku-4-5", type: "model" },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:painter", provider: "local", output: "image", reasoning: false },
      { id: "local:chatty", provider: "local", output: "text", reasoning: false },
      { id: "local:claude-haiku-4-5", provider: "local", output: "text", reasoning: true },
    ]);
  });

  it("classifies mistral-style chat capabilities", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "mistral-large", capabilities: { completion_chat: true } },
            { id: "mistral-embed-v2", capabilities: { completion_chat: false } },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:mistral-large", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("classifies image input from reported input modalities", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            {
              id: "google/gemini",
              architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            },
            {
              id: "deepseek/deepseek-chat",
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            },
            // An empty input list is no signal, not "text only".
            { id: "mystery", architecture: { input_modalities: [], output_modalities: ["text"] } },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:google/gemini",
        provider: "local",
        output: "text",
        imageInput: true,
        reasoning: false,
      },
      {
        id: "local:deepseek/deepseek-chat",
        provider: "local",
        output: "text",
        imageInput: false,
        reasoning: false,
      },
      { id: "local:mystery", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("reads an anthropic-style image_input capability", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "claude-opus-4-8", capabilities: { image_input: { supported: true } } },
            { id: "claude-text-only", capabilities: { image_input: { supported: false } } },
            // No image_input field — unknown, and the entry still lists.
            { id: "claude-bare", capabilities: {} },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      {
        id: "anthropic:claude-opus-4-8",
        provider: "anthropic",
        output: "text",
        imageInput: true,
        reasoning: true,
      },
      {
        id: "anthropic:claude-text-only",
        provider: "anthropic",
        output: "text",
        imageInput: false,
        reasoning: true,
      },
      { id: "anthropic:claude-bare", provider: "anthropic", output: "text", reasoning: true },
    ]);
  });

  it("reads a mistral-style vision capability", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "pixtral-large", capabilities: { completion_chat: true, vision: true } },
            { id: "mistral-large", capabilities: { completion_chat: true, vision: false } },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:pixtral-large",
        provider: "local",
        output: "text",
        imageInput: true,
        reasoning: false,
      },
      {
        id: "local:mistral-large",
        provider: "local",
        output: "text",
        imageInput: false,
        reasoning: false,
      },
    ]);
  });

  it("treats a together-style vlm type as accepting image input", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "llama-vision", type: "vlm" },
            // A plain chat type says nothing about input.
            { id: "llama-chat", type: "chat" },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:llama-vision",
        provider: "local",
        output: "text",
        imageInput: true,
        reasoning: false,
      },
      { id: "local:llama-chat", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("keeps router pseudo-models text-output despite their reported image modality", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            {
              id: "openrouter/auto",
              architecture: { output_modalities: ["text", "image"] },
              context_length: 2000000,
            },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:openrouter/auto",
        provider: "local",
        contextWindow: 2000000,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("classifies bare listings by well-known id families", async () => {
    server.use(
      modelList("https://api.openai.com/v1/models", [
        "gpt-image-1",
        "dall-e-3",
        "imagen-4.0-generate-001",
        "grok-2-image",
        "gpt-4o",
        "whisper-1",
        "tts-1-hd",
        "gpt-4o-audio-preview",
        "gpt-realtime",
        "text-embedding-3-small",
        "omni-moderation-latest",
        "sora-2",
        "veo-3.1-generate",
      ]),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:gpt-image-1", provider: "openai", output: "image", reasoning: false },
      { id: "openai:dall-e-3", provider: "openai", output: "image", reasoning: false },
      {
        id: "openai:imagen-4.0-generate-001",
        provider: "openai",
        output: "image",
        reasoning: false,
      },
      { id: "openai:grok-2-image", provider: "openai", output: "image", reasoning: false },
      { id: "openai:gpt-4o", provider: "openai", output: "text", reasoning: false },
    ]);
  });

  it("classifies reasoning support from a supported_parameters listing, either way", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({
          data: [
            { id: "deep-model", supported_parameters: ["temperature", "reasoning"] },
            { id: "effort-model", supported_parameters: ["reasoning_effort"] },
            { id: "include-model", supported_parameters: ["include_reasoning"] },
            // The array is authoritative: an id that *looks* reasoning-shaped
            // is still a no when the endpoint doesn't take the parameters.
            { id: "qwq-static", supported_parameters: ["temperature"] },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:deep-model", provider: "local", output: "text", reasoning: true },
      { id: "local:effort-model", provider: "local", output: "text", reasoning: true },
      { id: "local:include-model", provider: "local", output: "text", reasoning: true },
      { id: "local:qwq-static", provider: "local", output: "text", reasoning: false },
    ]);
  });

  it("classifies reasoning support by id family on bare listings", async () => {
    server.use(
      modelList("https://api.openai.com/v1/models", [
        "o3",
        "o4-mini",
        "gpt-5",
        "gpt-5.2-mini",
        "deepseek-r1-distill",
        "qwq-32b",
        "magistral-small",
        "qwen3-thinking",
        // Exclusions: the early o1 variants and the gpt-5 chat models take
        // no reasoning parameters.
        "o1-mini",
        "o1-preview",
        "gpt-5-chat-latest",
      ]),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:o3", provider: "openai", output: "text", reasoning: true },
      { id: "openai:o4-mini", provider: "openai", output: "text", reasoning: true },
      { id: "openai:gpt-5", provider: "openai", output: "text", reasoning: true },
      { id: "openai:gpt-5.2-mini", provider: "openai", output: "text", reasoning: true },
      { id: "openai:deepseek-r1-distill", provider: "openai", output: "text", reasoning: true },
      { id: "openai:qwq-32b", provider: "openai", output: "text", reasoning: true },
      { id: "openai:magistral-small", provider: "openai", output: "text", reasoning: true },
      { id: "openai:qwen3-thinking", provider: "openai", output: "text", reasoning: true },
      { id: "openai:o1-mini", provider: "openai", output: "text", reasoning: false },
      { id: "openai:o1-preview", provider: "openai", output: "text", reasoning: false },
      { id: "openai:gpt-5-chat-latest", provider: "openai", output: "text", reasoning: false },
    ]);
  });

  it("classifies claude ids as reasoning-capable except the pre-thinking families", async () => {
    server.use(
      modelList("https://api.anthropic.com/v1/models", [
        "claude-3-7-sonnet-latest",
        "claude-sonnet-4-5",
        "claude-3-5-sonnet-latest",
        "claude-3-haiku-20240307",
        "claude-2.1",
        "claude-instant-1.2",
      ]),
    );

    const result = await listLlmModels(registryWith(anthropic), { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      {
        id: "anthropic:claude-3-7-sonnet-latest",
        provider: "anthropic",
        output: "text",
        reasoning: true,
      },
      { id: "anthropic:claude-sonnet-4-5", provider: "anthropic", output: "text", reasoning: true },
      {
        id: "anthropic:claude-3-5-sonnet-latest",
        provider: "anthropic",
        output: "text",
        reasoning: false,
      },
      {
        id: "anthropic:claude-3-haiku-20240307",
        provider: "anthropic",
        output: "text",
        reasoning: false,
      },
      { id: "anthropic:claude-2.1", provider: "anthropic", output: "text", reasoning: false },
      {
        id: "anthropic:claude-instant-1.2",
        provider: "anthropic",
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("falls back to the id heuristic when the architecture field is malformed", async () => {
    server.use(
      http.get("https://api.openai.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "gpt-image-1", architecture: "nope" }] }),
      ),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([
      { id: "openai:gpt-image-1", provider: "openai", output: "image", reasoning: false },
    ]);
  });

  it("enriches an openai-compatible provider from LM Studio's native listing", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "google/gemma" }] }),
      ),
      http.get("http://localhost:1234/api/v0/models", () =>
        HttpResponse.json({
          data: [
            { id: "google/gemma", loaded_context_length: 8192, max_context_length: 262144 },
            "junk",
            { id: "unloaded-elsewhere" },
          ],
        }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    // Prefers the loaded (served) length over the model's maximum.
    expect(result.models).toEqual([
      {
        id: "local:google/gemma",
        provider: "local",
        contextWindow: 8192,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("falls back to a native model's max context when it is not loaded", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "google/gemma" }] }),
      ),
      http.get("http://localhost:1234/api/v0/models", () =>
        HttpResponse.json({ data: [{ id: "google/gemma", max_context_length: 262144 }] }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      {
        id: "local:google/gemma",
        provider: "local",
        contextWindow: 262144,
        output: "text",
        reasoning: false,
      },
    ]);
  });

  it("does not probe the native listing when /v1/models already reports context", async () => {
    let nativeProbed = false;
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "m", context_length: 200000 }] }),
      ),
      http.get("http://localhost:1234/api/v0/models", () => {
        nativeProbed = true;
        return HttpResponse.json({ data: [{ id: "m", max_context_length: 999 }] });
      }),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:m", provider: "local", contextWindow: 200000, output: "text", reasoning: false },
    ]);
    expect(nativeProbed).toBe(false);
  });

  it("leaves models bare when the native probe errors", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "google/gemma" }] }),
      ),
      http.get("http://localhost:1234/api/v0/models", () => HttpResponse.error()),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([
      { id: "local:google/gemma", provider: "local", output: "text", reasoning: false },
    ]);
  });
});
