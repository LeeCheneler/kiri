import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, streamText } from "ai";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { createLlmClients } from "./clients.ts";
import { CODEX_BASE_URL } from "./codex-fetch.ts";
import { effortProviderOptions } from "./effort.ts";
import { buildModelDescription } from "./model-description.ts";
import { createLlmProviderRegistry } from "./registry.ts";
import type { LlmProvider } from "./schema.ts";
import { sessionRequestOptions } from "./session-request-options.ts";

interface CapturedRequest {
  body: Record<string, unknown>;
  sessionHeader: string | null;
}

const clientsFor = (provider: LlmProvider, env: Record<string, string> = {}) => {
  const registry = createLlmProviderRegistry();
  registry.replace(new Map([[provider.name, provider]]));
  return createLlmClients(registry, env);
};

const captureChat = (url: string, requests: CapturedRequest[]) =>
  http.post(url, async ({ request }) => {
    requests.push({
      body: (await request.json()) as Record<string, unknown>,
      sessionHeader: request.headers.get("session-id"),
    });
    return HttpResponse.json({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    });
  });

const sessionIds = ["session-a", "session-a", "session-b"];

describe("session cache options on the wire", () => {
  it("keeps Codex cache keys and routing headers stable within a session and isolated across sessions", async () => {
    const provider: LlmProvider = { name: "subscription", type: "openai-codex" };
    const description = buildModelDescription(provider, "gpt-5.4-mini", {
      id: "subscription:gpt-5.4-mini",
      provider: provider.name,
      output: "text",
      reasoning: true,
      reasoningLevels: ["high"],
    });
    const requests: CapturedRequest[] = [];
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        requests.push({
          body: (await request.json()) as Record<string, unknown>,
          sessionHeader: request.headers.get("session-id"),
        });
        return new HttpResponse(
          [
            {
              type: "response.output_item.added",
              output_index: 0,
              item: { type: "message", id: "msg_1" },
            },
            { type: "response.output_text.delta", item_id: "msg_1", delta: "ok" },
            {
              type: "response.output_item.done",
              output_index: 0,
              item: { type: "message", id: "msg_1" },
            },
            {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 1 } },
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
      }),
    );
    // Keep fake credentials inside the worktree; never consult the user's Codex login.
    const home = await mkdtemp(join(process.cwd(), ".test-codex-cache-"));
    try {
      const payload = Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString("base64url");
      await writeFile(
        join(home, "auth.json"),
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { access_token: `header.${payload}.signature`, account_id: "test-account" },
        }),
      );
      const model = clientsFor(provider, { CODEX_HOME: home }).resolveModel(description.id);
      for (const sessionId of sessionIds) {
        const options = sessionRequestOptions(
          description,
          sessionId,
          effortProviderOptions(description, "high"),
        );
        const result = streamText({
          model,
          prompt: "hello",
          maxRetries: 0,
          ...options,
          onError: () => {},
        });
        expect(await result.text).toBe("ok");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }

    expect(requests.map(({ body }) => body.prompt_cache_key)).toEqual(sessionIds);
    expect(requests.map(({ sessionHeader }) => sessionHeader)).toEqual(sessionIds);
    for (const { body } of requests) {
      expect(body).toMatchObject({
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "high" },
      });
    }
  });

  it("sends public OpenAI cache keys without Codex routing headers and preserves reasoning", async () => {
    const provider: LlmProvider = { name: "public-api", type: "openai", apiKeyEnv: "TEST_KEY" };
    const description = buildModelDescription(provider, "gpt-5", undefined);
    const model = clientsFor(provider, { TEST_KEY: "sk-test" }).resolveModel(description.id);
    const requests: CapturedRequest[] = [];
    server.use(captureChat("https://api.openai.com/v1/chat/completions", requests));

    for (const sessionId of sessionIds) {
      const options = sessionRequestOptions(
        description,
        sessionId,
        effortProviderOptions(description, "high"),
      );
      await generateText({
        model,
        prompt: "hello",
        maxRetries: 0,
        ...options,
      });
    }

    expect(requests.map(({ body }) => body.prompt_cache_key)).toEqual(sessionIds);
    expect(requests.map(({ sessionHeader }) => sessionHeader)).toEqual([null, null, null]);
    for (const { body } of requests) expect(body.reasoning_effort).toBe("high");
  });

  it("serializes Anthropic automatic cache control alongside effort", async () => {
    const provider: LlmProvider = { name: "claude-api", type: "anthropic", apiKeyEnv: "TEST_KEY" };
    const description = buildModelDescription(provider, "claude-opus-4-7", undefined);
    const model = clientsFor(provider, { TEST_KEY: "sk-test" }).resolveModel(description.id);
    const requests: CapturedRequest[] = [];
    server.use(
      http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
        requests.push({
          body: (await request.json()) as Record<string, unknown>,
          sessionHeader: request.headers.get("session-id"),
        });
        return HttpResponse.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: description.modelId,
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }),
    );
    const options = sessionRequestOptions(
      description,
      "session-a",
      effortProviderOptions(description, "high"),
    );

    await generateText({
      model,
      prompt: "hello",
      maxRetries: 0,
      ...options,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({
      cache_control: { type: "ephemeral" },
      output_config: { effort: "high" },
    });
    expect(requests[0]?.sessionHeader).toBeNull();
  });

  it.each(["anthropic/claude-opus-4.7", "openai/gpt-5", "anthropic/not-claude"])(
    "uses the configured OpenRouter alias and only marks Claude for caching (%s)",
    async (modelId) => {
      const provider: LlmProvider = {
        name: "router-alias",
        type: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "TEST_KEY",
      };
      const description = buildModelDescription(provider, modelId, {
        id: `${provider.name}:${modelId}`,
        provider: provider.name,
        output: "text",
        reasoning: true,
        nativeDocuments: false,
      });
      const requests: CapturedRequest[] = [];
      server.use(
        http.get("https://openrouter.ai/api/v1/models", () =>
          HttpResponse.json({
            data: [{ id: modelId, architecture: { input_modalities: ["text"] } }],
          }),
        ),
        captureChat("https://openrouter.ai/api/v1/chat/completions", requests),
      );
      const model = clientsFor(provider, { TEST_KEY: "sk-test" }).resolveModel(description.id);

      for (const sessionId of sessionIds) {
        const options = sessionRequestOptions(
          description,
          sessionId,
          effortProviderOptions(description, "high"),
        );
        await generateText({
          model,
          maxRetries: 0,
          ...options,
          messages: [
            {
              role: "user",
              content: [
                { type: "file", mediaType: "application/pdf", filename: "a.pdf", data: "AQI=" },
                { type: "text", text: "Summarise" },
              ],
            },
          ],
        });
      }

      expect(requests.map(({ body }) => body.session_id)).toEqual(sessionIds);
      for (const { body, sessionHeader } of requests) {
        expect(body.reasoning_effort).toBe("high");
        expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
        expect(body.cache_control).toEqual(
          modelId === "anthropic/claude-opus-4.7" ? { type: "ephemeral" } : undefined,
        );
        expect(body.prompt_cache_key).toBeUndefined();
        expect(sessionHeader).toBeNull();
      }
    },
  );

  it("does not send unsupported cache controls to a custom compatible endpoint", async () => {
    const provider: LlmProvider = {
      name: "custom",
      type: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
    };
    const description = buildModelDescription(provider, "anthropic/claude-opus-4.7", undefined);
    const requests: CapturedRequest[] = [];
    server.use(captureChat("http://localhost:1234/v1/chat/completions", requests));
    const options = sessionRequestOptions(description, "session-a");

    await generateText({
      model: clientsFor(provider).resolveModel(description.id),
      prompt: "hello",
      maxRetries: 0,
      ...options,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.sessionHeader).toBeNull();
    for (const key of ["prompt_cache_key", "session_id", "cache_control"]) {
      expect(requests[0]?.body).not.toHaveProperty(key);
    }
  });
});
