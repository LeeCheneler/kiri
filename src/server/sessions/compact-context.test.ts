import { describe, expect, it } from "bun:test";
import { compactContext } from "./compact-context.ts";

describe("compactContext", () => {
  const options = {
    model: "test:session-model",
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
