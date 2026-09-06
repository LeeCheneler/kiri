import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type UIMessage, streamText, tool } from "ai";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { bootstrap } from "../../src/server/bootstrap.ts";
import { loadKiriConfig } from "../../src/server/config/loader.ts";
import { createConfigStore } from "../../src/server/config/store.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import { CODEX_BASE_URL } from "../../src/server/llm/codex-fetch.ts";
import {
  type LlmClients,
  createLlmClients,
  createLlmProviderRegistry,
  effortProviderOptions,
  generateLlmText,
} from "../../src/server/llm/index.ts";
import { runLlmStep } from "../../src/server/runner/run-llm-step.ts";
import {
  createSession,
  getSession,
  getSessionMessages,
  runTurn,
} from "../../src/server/sessions/index.ts";
import { server } from "../setup/msw.ts";

const completed = {
  type: "response.completed",
  response: {
    usage: { input_tokens: 30, output_tokens: 10, output_tokens_details: { reasoning_tokens: 3 } },
  },
};
const textEvents = [
  { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1" } },
  { type: "response.output_text.delta", item_id: "msg_1", delta: "violet" },
  { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1" } },
  completed,
];
const sse = (events: unknown[]) =>
  new HttpResponse(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
const listedModel = {
  slug: "gpt-5.4-mini",
  visibility: "list",
  context_window: 200_000,
  input_modalities: ["text", "image"],
  supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
};
const provider = { name: "chatgpt", type: "openai-codex" as const };

describe("Codex provider through the AI SDK", () => {
  let cwd: string;
  let clients: LlmClients;
  let db: KiriDb;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-codex-provider-"));
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString("base64url");
    writeFileSync(
      join(cwd, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: `header.${payload}.signature`, account_id: "account" },
      }),
    );
    writeFileSync(join(cwd, "kiri.yaml"), "providers:\n  chatgpt:\n    type: openai-codex\n");
    const config = createConfigStore(cwd);
    db = bootstrap(config);
    const registry = createLlmProviderRegistry();
    registry.replace(loadKiriConfig(config, {}).providers);
    clients = createLlmClients(registry, { CODEX_HOME: cwd });
    server.use(
      http.get(`${CODEX_BASE_URL}/models`, () => HttpResponse.json({ models: [listedModel] })),
    );
  });
  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("collects a streamed utility completion with usage and no API-key fallback", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        expect(request.headers.get("authorization")).toStartWith("Bearer header.");
        expect(request.headers.get("chatgpt-account-id")).toBe("account");
        return sse(textEvents);
      }),
    );
    const result = await clients.generateText({ model: "chatgpt:gpt-5.4-mini", prompt: "hello" });
    expect(result).toEqual({
      text: "violet",
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
    });
    expect(body).toMatchObject({
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    });
    const direct = await generateLlmText({
      model: clients.resolveModel("chatgpt:gpt-5.4-mini"),
      prompt: "hello",
    });
    expect(direct.text).toBe("violet");
  });

  it("keeps system instructions and effort while enforcing stateless requests", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return sse(textEvents);
      }),
    );
    const result = streamText({
      model: clients.resolveModel("chatgpt:future-reasoning-model"),
      system: "Kiri system prompt",
      prompt: "hello",
      providerOptions: {
        openai: {
          store: true,
          ...effortProviderOptions(provider, "future-reasoning-model", "high", ["high"])?.openai,
        },
      },
    });
    expect(await result.text).toBe("violet");
    expect(body).toMatchObject({ store: false, reasoning: { effort: "high" } });
    expect(body?.input).toContainEqual({ role: "developer", content: "Kiri system prompt" });
  });

  it("runs an llm step through the streaming adapter and preserves its envelope", async () => {
    let input: unknown;
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        input = ((await request.json()) as { input: unknown }).input;
        return sse(textEvents);
      }),
    );
    const result = await runLlmStep({
      step: { llm: { model: "chatgpt:gpt-5.4-mini", prompt: "Hello {{NAME}}" } },
      config: createConfigStore(cwd),
      env: { NAME: "Kiri" },
      llmClients: clients,
    });
    expect(result.status).toBe("ok");
    expect(result.output).toBe("violet");
    expect(result.traces.usage).toEqual({ inputTokens: 30, outputTokens: 10, totalTokens: 40 });
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Hello Kiri" }] },
    ]);
  });

  it("surfaces an authentication failure to utility callers", async () => {
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, () => new HttpResponse(null, { status: 401 })),
    );
    await expect(
      clients.generateText({ model: "chatgpt:gpt-5.4-mini", prompt: "hello" }),
    ).rejects.toThrow("Run `codex login`");
  });

  it("rejects streamed errors instead of returning partial success", async () => {
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, () =>
        sse([
          ...textEvents.slice(0, 2),
          {
            type: "error",
            sequence_number: 1,
            error: { type: "server_error", code: "failed", message: "generation failed" },
          },
        ]),
      ),
    );
    await expect(
      clients.generateText({ model: "chatgpt:gpt-5.4-mini", prompt: "hello" }),
    ).rejects.toBeDefined();
  });

  it("propagates cancellation during utility streaming", async () => {
    const controller = new AbortController();
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, () => {
        controller.abort(new Error("cancelled by user"));
        return sse(textEvents);
      }),
    );
    await expect(
      clients.generateText({
        model: "chatgpt:gpt-5.4-mini",
        prompt: "hello",
        abortSignal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });

  it("lists only visible models and carries capabilities into effort resolution", async () => {
    server.use(
      http.get(`${CODEX_BASE_URL}/models`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("client_version")).toBe("0.153.4");
        return HttpResponse.json({
          models: [
            listedModel,
            { ...listedModel, slug: "hidden", visibility: "hide" },
            { slug: "plain", visibility: "list" },
            {
              slug: "none-only",
              visibility: "list",
              supported_reasoning_levels: [{ effort: "none" }],
            },
            { slug: 42 },
          ],
        });
      }),
    );
    const { models, failures } = await clients.listModels();
    expect(failures).toEqual([]);
    expect(models.map((m) => m.id)).toEqual([
      "chatgpt:gpt-5.4-mini",
      "chatgpt:plain",
      "chatgpt:none-only",
    ]);
    expect(models[0]).toMatchObject({
      contextWindow: 200_000,
      imageInput: true,
      output: "text",
      reasoning: true,
      reasoningLevels: ["low", "high"],
    });
    expect(models[1]).toMatchObject({ reasoning: false, reasoningLevels: [] });
    expect(await clients.contextWindowFor("chatgpt:gpt-5.4-mini")).toBe(200_000);
    expect(await clients.reasoningOptionsFor("chatgpt:gpt-5.4-mini", "max")).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
    });
    expect(await clients.reasoningOptionsFor("chatgpt:gpt-5.4-mini", "medium")).toEqual({
      openai: { reasoningEffort: "low", forceReasoning: true },
    });
    expect(await clients.reasoningOptionsFor("chatgpt:plain", "high")).toBeUndefined();
    expect(await clients.reasoningOptionsFor("chatgpt:none-only", "high")).toBeUndefined();
  });

  it("handles a model whose lowest supported effort exceeds the requested one", () => {
    expect(effortProviderOptions(provider, "model", "low", ["high", "xhigh"])).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
    });
    expect(effortProviderOptions(provider, "model", "max", ["high", "xhigh"])).toEqual({
      openai: { reasoningEffort: "xhigh", forceReasoning: true },
    });
    expect(effortProviderOptions(provider, "model", "high")).toBeUndefined();
  });

  it("collects listing failures without failing the aggregate", async () => {
    server.use(http.get(`${CODEX_BASE_URL}/models`, () => new HttpResponse(null, { status: 503 })));
    expect(await clients.listModels()).toEqual({
      models: [],
      failures: [{ provider: "chatgpt", reason: "503 Service Unavailable" }],
    });
  });

  it("rejects image generation and transcription", () => {
    expect(() => clients.resolveImageModel("chatgpt:gpt-5.4-mini")).toThrow(
      "offers no image generation",
    );
    expect(() => clients.resolveTranscriptionModel("chatgpt:gpt-5.4-mini")).toThrow(
      "offers no transcription",
    );
  });

  it("persists reasoning and tool results and replays them on the next Kiri turn", async () => {
    const bodies: { input: Array<Record<string, unknown>> }[] = [];
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        bodies.push((await request.json()) as (typeof bodies)[number]);
        if (bodies.length > 1) return sse(textEvents);
        return sse([
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "reasoning", id: "rs_1" },
          },
          {
            type: "response.reasoning_summary_text.delta",
            item_id: "rs_1",
            summary_index: 0,
            delta: "I will look it up.",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: { type: "reasoning", id: "rs_1", encrypted_content: "encrypted-reasoning" },
          },
          {
            type: "response.output_item.added",
            output_index: 1,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "lookup",
              arguments: "",
            },
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            item_id: "fc_1",
            delta: '{"key":"test"}',
          },
          {
            type: "response.output_item.done",
            output_index: 1,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "lookup",
              arguments: '{"key":"test"}',
              status: "completed",
            },
          },
          completed,
        ]);
      }),
    );
    const session = createSession(db, "chatgpt:gpt-5.4-mini");
    const tools = {
      lookup: tool({
        description: "Look up a value",
        inputSchema: z.object({ key: z.string() }),
        execute: async () => "violet",
      }),
    };
    const userMessage = (text: string): UIMessage => ({
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    });
    const first = await runTurn(
      { db, llmClients: clients, tools },
      { session, userMessage: userMessage("Look up test") },
    );
    await first.done;
    expect(getSession(db, session.id)?.status).toBe("idle");
    const stored = getSessionMessages(db, session.id);
    expect(stored[1].contextTokens).toBeGreaterThan(0);
    expect(JSON.stringify(stored[1].parts)).toContain("encrypted-reasoning");
    expect(bodies[1].input).toContainEqual(
      expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
    );
    const second = await runTurn(
      { db, llmClients: clients, tools },
      {
        session: getSession(db, session.id) as typeof session,
        userMessage: userMessage("What was the value?"),
      },
    );
    await second.done;
    expect(bodies).toHaveLength(3);
    expect(bodies[2].input).toContainEqual(
      expect.objectContaining({ type: "reasoning", encrypted_content: "encrypted-reasoning" }),
    );
    expect(bodies[2].input).toContainEqual(
      expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
    );
    expect(bodies[2].input.some((item) => item.type === "item_reference")).toBe(false);
    expect(getSessionMessages(db, session.id)).toHaveLength(4);
    expect(getSession(db, session.id)?.status).toBe("idle");
  });
});
