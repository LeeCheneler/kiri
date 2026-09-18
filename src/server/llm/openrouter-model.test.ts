import { describe, expect, it } from "bun:test";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { buildModelDescription } from "./model-description.ts";
import { createOpenRouterModel, withDocumentParser } from "./openrouter-model.ts";

const PDF = "application/pdf";

// An OpenRouter model whose listing says `nativeDocuments` about document input.
const described = (nativeDocuments: boolean | undefined) =>
  buildModelDescription(
    { name: "openrouter", type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1" },
    "vendor/model",
    {
      id: "openrouter:vendor/model",
      provider: "openrouter",
      output: "text",
      reasoning: false,
      nativeDocuments,
    },
  );

const parser = { plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] };

const call = (content: LanguageModelV3CallOptions["prompt"][number]["content"]) =>
  ({ prompt: [{ role: "user", content }] }) as LanguageModelV3CallOptions;
const withPdf = () =>
  call([
    { type: "file", mediaType: PDF, data: "AQI=" },
    { type: "text", text: "Summarise" },
  ]);

describe("withDocumentParser", () => {
  it("asks for the free parser when a document rides to a model without native support", () => {
    for (const native of [false, undefined]) {
      expect(withDocumentParser(withPdf(), described(native)).providerOptions).toEqual({
        openrouter: parser,
      });
    }
  });

  it("keeps the provider's other options alongside the parser", () => {
    const params = { ...withPdf(), providerOptions: { openrouter: { reasoningEffort: "high" } } };
    expect(withDocumentParser(params, described(false)).providerOptions).toEqual({
      openrouter: { reasoningEffort: "high", ...parser },
    });
  });

  it("leaves a natively document-capable model to OpenRouter's default handling", () => {
    const params = withPdf();
    expect(withDocumentParser(params, described(true))).toBe(params);
  });

  it("leaves a document the endpoint doesn't parse untouched", () => {
    const word = call([{ type: "file", mediaType: "application/msword", data: "AQI=" }]);
    expect(withDocumentParser(word, described(false))).toBe(word);
  });

  it("leaves a request without documents untouched, whatever the model", () => {
    const text = call("plain text prompt");
    const image = call([{ type: "file", mediaType: "image/png", data: "AQI=" }]);
    expect(withDocumentParser(text, described(false))).toBe(text);
    expect(withDocumentParser(image, described(undefined))).toBe(image);
  });
});

describe("createOpenRouterModel", () => {
  it("describes the model per request and rewrites the call accordingly", async () => {
    const base = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    let native: boolean | undefined = false;
    const model = createOpenRouterModel(base, async () => described(native));

    await model.doGenerate(withPdf());
    native = true;
    await model.doGenerate(withPdf());

    expect(base.doGenerateCalls.map((params) => params.providerOptions)).toEqual([
      { openrouter: parser },
      undefined,
    ]);
  });
});
