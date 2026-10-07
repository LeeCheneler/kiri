import { describe, expect, it } from "bun:test";
import { type ModelMessage, generateText } from "ai";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { FAKE_IMAGE_B64 } from "../../../tests/support/fake-openai.ts";
import { createLlmClients, createLlmProviderRegistry } from "../llm/index.ts";
import { compactContext } from "./compact-context.ts";

describe("compactContext", () => {
  const options = {
    model: "test:session-model",
    imageInput: true,
    messages: [{ role: "user" as const, content: "Review /work/src/app.ts; do not publish." }],
    system: "Current workspace instructions",
    inputBudget: 20000,
    summaryBudget: 2000,
    abortSignal: new AbortController().signal,
  };

  it("uses the selected model and a tool-free prompt that preserves continuation and action safety", async () => {
    const checkpoint = await compactContext({
      ...options,
      llmClients: {
        generateText: async (request) => {
          expect(request.model).toBe(options.model);
          expect(request.abortSignal).toBe(options.abortSignal);
          expect(Object.keys(request).sort()).toEqual(["abortSignal", "model", "prompt", "system"]);
          expect(JSON.parse(request.prompt)).toEqual({
            standingInstructions: options.system,
            messages: options.messages,
          });
          expect(request.system).toContain("Do not answer any question in the transcript");
          expect(request.system).toContain("Preserve unanswered user requests verbatim");
          expect(request.system).toContain("Completed actions and their results");
          expect(request.system).toContain("pending approvals");
          expect(request.system).toContain("will not be retrievable");
          expect(request.system).toContain("at most 2000 tokens");
          return { text: "  Review in progress. Publishing prohibited.\n", usage: {} };
        },
      },
    });
    expect(checkpoint).toEqual({
      type: "data-checkpoint",
      id: expect.any(String),
      data: { summary: "Review in progress. Publishing prohibited." },
    });
  });

  it("skips generation when its prompt cannot fit", async () => {
    let calls = 0;
    expect(
      await compactContext({
        ...options,
        system: undefined,
        inputBudget: 100,
        llmClients: {
          generateText: async () => {
            calls += 1;
            return { text: "summary", usage: {} };
          },
        },
      }),
    ).toBeNull();
    expect(calls).toBe(0);
  });

  it("summarises images as visual input and excludes opaque provider metadata", async () => {
    const data = `data:image/png;base64,${"a".repeat(211600)}`;
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "file" as const, mediaType: "image/png", data },
          { type: "text" as const, text: "Match the screenshot" },
        ],
      },
      {
        role: "assistant" as const,
        content: [
          {
            type: "reasoning" as const,
            text: "The heading needs more space",
            providerOptions: { openai: { reasoningEncryptedContent: "opaque".repeat(10000) } },
          },
        ],
      },
    ];
    const before = structuredClone(messages);
    let calls = 0;
    const checkpoint = await compactContext({
      ...options,
      messages,
      inputBudget: 30000,
      llmClients: {
        generateText: async (request) => {
          calls += 1;
          expect(request.images).toEqual([{ type: "image", image: data, mediaType: "image/png" }]);
          expect(request.prompt).toContain("Image attachment 1");
          expect(request.prompt).toContain("Match the screenshot");
          expect(request.prompt).toContain("The heading needs more space");
          expect(request.prompt).not.toContain(data);
          expect(request.prompt).not.toContain("opaque");
          return { text: "Adjust the heading to match the screenshot", usage: {} };
        },
      },
    });
    expect(calls).toBe(1);
    expect(checkpoint?.data.summary).toContain("Adjust the heading");
    expect(messages).toEqual(before);
  });

  it("extracts typed tool images in transcript order without inflating the summary text budget", async () => {
    const data = "a".repeat(211600);
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "image", image: "AAAA", mediaType: "image/png" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "capture-1",
            toolName: "third_party__capture",
            output: {
              type: "content",
              value: [
                { type: "text", text: "The first screen" },
                {
                  type: "image-data",
                  data,
                  mediaType: "image/png",
                  providerOptions: { test: { opaque: "private" } },
                },
                { type: "image-data", data: "BBBB", mediaType: "image/jpeg" },
                { type: "text", text: "The second screen" },
              ],
            },
          },
        ],
      },
    ];
    const before = structuredClone(messages);
    let calls = 0;
    const checkpoint = await compactContext({
      ...options,
      messages,
      inputBudget: 30000,
      llmClients: {
        generateText: async (request) => {
          calls += 1;
          expect(request.images).toEqual([
            { type: "image", image: "AAAA", mediaType: "image/png", providerOptions: undefined },
            { type: "image", image: data, mediaType: "image/png" },
            { type: "image", image: "BBBB", mediaType: "image/jpeg" },
          ]);
          const prompt = JSON.parse(request.prompt);
          expect(prompt.messages[1].content[0]).toMatchObject({
            toolCallId: "capture-1",
            toolName: "third_party__capture",
            output: {
              type: "content",
              value: [
                { type: "text", text: "The first screen" },
                { type: "text", text: expect.stringContaining("Tool image 2") },
                { type: "text", text: expect.stringContaining("Tool image 3") },
                { type: "text", text: "The second screen" },
              ],
            },
          });
          expect(request.prompt).toContain("Image attachment 1");
          expect(request.prompt).not.toContain(data);
          expect(request.prompt).not.toContain("private");
          return { text: "Two tool screenshots follow the user's reference image.", usage: {} };
        },
      },
    });
    expect(calls).toBe(1);
    expect(checkpoint?.data.summary).toContain("Two tool screenshots");
    expect(messages).toEqual(before);
  });

  it("does not infer images from JSON tool output or text that resembles a data URL", async () => {
    const data = "data:image/png;base64,AAAA";
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "json-1",
            toolName: "arbitrary__json",
            output: { type: "json", value: { image: data, mimeType: "image/png" } },
          },
          {
            type: "tool-result",
            toolCallId: "text-1",
            toolName: "arbitrary__text",
            output: { type: "content", value: [{ type: "text", text: data }] },
          },
        ],
      },
    ];
    await compactContext({
      ...options,
      messages,
      llmClients: {
        generateText: async (request) => {
          expect(request.images).toBeUndefined();
          expect(JSON.parse(request.prompt).messages).toEqual(messages);
          return { text: "The results are text and JSON, not visual content.", usage: {} };
        },
      },
    });
  });

  it("sends an MCP screenshot to the real summarisation adapter as native image input", async () => {
    let received: unknown;
    server.use(
      http.post("http://compaction.invalid/v1/chat/completions", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          id: "summary-1",
          object: "chat.completion",
          created: 0,
          model: "fixture",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Screenshot reviewed." },
              finish_reason: "stop",
            },
          ],
        });
      }),
    );
    const registry = createLlmProviderRegistry();
    registry.replace(
      new Map([
        [
          "fixture",
          { name: "fixture", type: "openai-compatible", baseUrl: "http://compaction.invalid/v1" },
        ],
      ]),
    );
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "capture-1",
            toolName: "any_server__capture",
            output: {
              type: "content",
              value: [
                { type: "text", text: "Captured page" },
                { type: "image-data", data: FAKE_IMAGE_B64, mediaType: "image/png" },
              ],
            },
          },
        ],
      },
    ];
    const checkpoint = await compactContext({
      ...options,
      messages,
      model: "fixture:fixture",
      llmClients: createLlmClients(registry, {}),
    });
    expect(checkpoint?.data.summary).toBe("Screenshot reviewed.");
    const prompt = (received as { messages: { content: { text?: string }[] }[] }).messages[1]
      ?.content[0]?.text;
    expect(prompt).toContain("Captured page");
    expect(prompt).not.toContain(FAKE_IMAGE_B64);
    expect(received).toMatchObject({
      messages: [
        { role: "system" },
        {
          role: "user",
          content: [
            { type: "text", text: expect.stringContaining("Tool image 1") },
            { type: "image_url", image_url: { url: `data:image/png;base64,${FAKE_IMAGE_B64}` } },
          ],
        },
      ],
    });
  });

  it("compacts a successful screenshot result through a text-only adapter without introducing visual input", async () => {
    const received: { messages: { role: string; content: unknown }[] }[] = [];
    server.use(
      http.post("http://text-only.invalid/v1/chat/completions", async ({ request }) => {
        const body = (await request.json()) as (typeof received)[number];
        received.push(body);
        if (
          body.messages.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some((part) => part.type === "image_url"),
          )
        ) {
          return HttpResponse.json(
            {
              error: {
                message: "This model does not accept image input",
                type: "invalid_request_error",
              },
            },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          id: "text-only-1",
          object: "chat.completion",
          created: 0,
          model: "text-only",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Capture completed; visual inspection remains unverified.",
              },
              finish_reason: "stop",
            },
          ],
        });
      }),
    );
    const registry = createLlmProviderRegistry();
    registry.replace(
      new Map([
        [
          "fixture",
          { name: "fixture", type: "openai-compatible", baseUrl: "http://text-only.invalid/v1" },
        ],
      ]),
    );
    const llmClients = createLlmClients(registry, {});
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "capture-1", toolName: "capture__screen", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "capture-1",
            toolName: "capture__screen",
            output: {
              type: "content",
              value: [
                { type: "text", text: "Capture completed." },
                { type: "image-data", data: FAKE_IMAGE_B64, mediaType: "image/png" },
              ],
            },
          },
        ],
      },
    ];
    const before = structuredClone(messages);
    const ordinary = await generateText({
      model: llmClients.resolveModel("fixture:text-only"),
      messages,
    });
    expect(ordinary.text).toContain("Capture completed");
    expect(received[0]?.messages.find((message) => message.role === "tool")?.content).toContain(
      FAKE_IMAGE_B64,
    );

    const checkpoint = await compactContext({
      ...options,
      model: "fixture:text-only",
      imageInput: false,
      messages,
      llmClients,
    });
    expect(checkpoint?.data.summary).toContain("visual inspection remains unverified");
    expect(received).toHaveLength(2);
    const summaryInput = JSON.stringify(received[1]?.messages);
    expect(summaryInput).toContain("Tool image 1");
    expect(summaryInput).toContain("no confirmed image input support");
    expect(summaryInput).toContain("Capture completed.");
    expect(summaryInput).not.toContain("image_url");
    expect(summaryInput).not.toContain(FAKE_IMAGE_B64);
    expect(messages).toEqual(before);
  });

  it("keeps shared numbered references for tool and attachment images without visual support", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "image", image: "AAAA", mediaType: "image/png" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "capture__screen",
            output: {
              type: "content",
              value: [{ type: "image-data", data: "BBBB", mediaType: "image/jpeg" }],
            },
          },
        ],
      },
      { role: "user", content: [{ type: "file", data: "CCCC", mediaType: "image/png" }] },
    ];
    const before = structuredClone(messages);
    const checkpoint = await compactContext({
      ...options,
      imageInput: false,
      messages,
      llmClients: {
        generateText: async (request) => {
          expect(request.images).toBeUndefined();
          expect(request.prompt).toContain("Image attachment 1");
          expect(request.prompt).toContain("Tool image 2");
          expect(request.prompt).toContain("Image attachment 3");
          expect(request.prompt).not.toContain("supplied after the transcript");
          for (const data of ["AAAA", "BBBB", "CCCC"]) expect(request.prompt).not.toContain(data);
          return { text: "Three images were not supplied for visual inspection.", usage: {} };
        },
      },
    });
    expect(checkpoint?.data.summary).toContain("Three images");
    expect(messages).toEqual(before);
  });

  it("stands documents in with a placeholder instead of their bytes", async () => {
    const data = "a".repeat(120000);
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "file" as const, mediaType: "application/pdf", filename: "brief.pdf", data },
          { type: "file" as const, mediaType: "application/pdf", data },
          { type: "text" as const, text: "Summarise the brief" },
        ],
      },
    ];
    const before = structuredClone(messages);
    let calls = 0;
    const checkpoint = await compactContext({
      ...options,
      messages,
      llmClients: {
        generateText: async (request) => {
          calls += 1;
          expect(request.images).toBeUndefined();
          expect(request.prompt).toContain("Document attachment 1: brief.pdf");
          expect(request.prompt).toContain("Document attachment 2;");
          expect(request.prompt).toContain("Summarise the brief");
          expect(request.prompt).not.toContain(data);
          return { text: "The brief asks for a summary", usage: {} };
        },
      },
    });
    expect(calls).toBe(1);
    expect(checkpoint?.data.summary).toContain("The brief");
    expect(messages).toEqual(before);
  });

  it("rejects an empty summary and lets provider errors reach the turn handler", async () => {
    expect(
      await compactContext({
        ...options,
        llmClients: { generateText: async () => ({ text: " \n", usage: {} }) },
      }),
    ).toBeNull();
    await expect(
      compactContext({
        ...options,
        llmClients: {
          generateText: async () => {
            throw new Error("provider unavailable");
          },
        },
      }),
    ).rejects.toThrow("provider unavailable");
  });

  it("honours cancellation even if the provider returns text after being aborted", async () => {
    const controller = new AbortController();
    await expect(
      compactContext({
        ...options,
        abortSignal: controller.signal,
        llmClients: {
          generateText: async () => {
            controller.abort();
            return { text: "Too late", usage: {} };
          },
        },
      }),
    ).rejects.toThrow();
  });
});
