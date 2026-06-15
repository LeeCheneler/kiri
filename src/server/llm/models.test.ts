import { describe, expect, it } from "bun:test";
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
});
