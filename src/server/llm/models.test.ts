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

    expect(result.models).toEqual([{ id: "anthropic:claude-haiku-4-5", provider: "anthropic" }]);
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

    expect(result.models).toEqual([{ id: "openai:gpt-4o-mini", provider: "openai" }]);
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

    expect(result.models).toEqual([{ id: "local:some-model", provider: "local" }]);
    expect(headers?.get("authorization")).toBeNull();
  });

  it("normalises a trailing slash on the configured base_url", async () => {
    server.use(modelList("http://localhost:1234/v1/models", ["m1"]));
    const trailing: LlmProvider = { ...local, baseUrl: "http://localhost:1234/v1/" };

    const result = await listLlmModels(registryWith(trailing), {});

    expect(result.models).toEqual([{ id: "local:m1", provider: "local" }]);
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
      { id: "anthropic:claude-haiku-4-5", provider: "anthropic" },
      { id: "local:a", provider: "local" },
      { id: "local:b", provider: "local" },
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

    expect(result.models).toEqual([{ id: "local:ok", provider: "local" }]);
    expect(result.failures).toEqual([{ provider: "openai", reason: "500 Internal Server Error" }]);
  });

  it("filters out non-string model ids", async () => {
    server.use(modelList("https://api.openai.com/v1/models", ["gpt-4o", 123, null]));

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([{ id: "openai:gpt-4o", provider: "openai" }]);
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
      { id: "local:anthropic/claude", provider: "local", contextWindow: 64000, outputLimit: 8192 },
    ]);
  });

  it("reads a vLLM-style max_model_len", async () => {
    server.use(
      http.get("http://localhost:1234/v1/models", () =>
        HttpResponse.json({ data: [{ id: "qwen", max_model_len: 32768 }] }),
      ),
    );

    const result = await listLlmModels(registryWith(local), {});

    expect(result.models).toEqual([{ id: "local:qwen", provider: "local", contextWindow: 32768 }]);
  });

  it("ignores non-positive or non-numeric limit fields", async () => {
    server.use(
      http.get("https://api.openai.com/v1/models", () =>
        HttpResponse.json({ data: [{ id: "gpt-x", max_input_tokens: 0, context_length: "nope" }] }),
      ),
    );

    const result = await listLlmModels(registryWith(openai), { OPENAI_API_KEY: "sk-test" });

    expect(result.models).toEqual([{ id: "openai:gpt-x", provider: "openai" }]);
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
      { id: "local:google/gemma", provider: "local", contextWindow: 8192 },
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
      { id: "local:google/gemma", provider: "local", contextWindow: 262144 },
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

    expect(result.models).toEqual([{ id: "local:m", provider: "local", contextWindow: 200000 }]);
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

    expect(result.models).toEqual([{ id: "local:google/gemma", provider: "local" }]);
  });
});
