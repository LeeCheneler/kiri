import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type LlmProvider,
  createLlmClients,
  createLlmProviderRegistry,
} from "../../src/server/llm/index.ts";
import { type FakeOpenAi, startFakeOpenAi } from "../support/fake-openai.ts";

/**
 * Integration coverage for model listing over the real `GET /models` request the
 * unit tests mock out. Proves the request shape against a live OpenAI-compatible
 * endpoint, the `provider:model` namespacing, and that a single unreachable
 * provider is collected as a failure rather than sinking the whole aggregate.
 */
describe("llm model listing", () => {
  let fake: FakeOpenAi;

  beforeAll(() => {
    fake = startFakeOpenAi();
  });

  afterAll(() => {
    fake.stop();
  });

  const clientsFor = (...providers: LlmProvider[]) => {
    const registry = createLlmProviderRegistry();
    registry.replace(new Map(providers.map((p) => [p.name, p])));
    return createLlmClients(registry, process.env);
  };

  it("lists a live provider's models, namespaced as provider:model", async () => {
    const clients = clientsFor({ name: "fake", type: "openai-compatible", baseUrl: fake.url });

    const result = await clients.listModels();

    expect(result.failures).toEqual([]);
    expect(result.models.map((m) => m.id).sort()).toEqual([
      "fake:boom",
      "fake:echo",
      "fake:slow",
      "fake:tool",
    ]);
    expect(result.models.every((m) => m.provider === "fake")).toBe(true);
  });

  it("collects an unreachable provider as a failure while live ones still resolve", async () => {
    const clients = clientsFor(
      { name: "fake", type: "openai-compatible", baseUrl: fake.url },
      // Port 1 is unbound — the fetch refuses fast.
      { name: "dead", type: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1" },
    );

    const result = await clients.listModels();

    expect(result.models.map((m) => m.provider)).toEqual(["fake", "fake", "fake", "fake"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].provider).toBe("dead");
    expect(result.failures[0].reason).toBeTruthy();
  });
});
