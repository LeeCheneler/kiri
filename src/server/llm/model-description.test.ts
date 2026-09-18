import { describe, expect, it } from "bun:test";
import { acceptedDocuments, buildModelDescription, toModelInfo } from "./model-description.ts";
import type { ListedModel } from "./models.ts";
import type { LlmProvider } from "./schema.ts";

const anthropic: LlmProvider = { name: "anthropic", type: "anthropic" };
const local: LlmProvider = {
  name: "local",
  type: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
};
const openrouter: LlmProvider = {
  name: "openrouter",
  type: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1",
};

const listed = (provider: LlmProvider, modelId: string, facts: Partial<ListedModel> = {}) =>
  buildModelDescription(provider, modelId, {
    id: `${provider.name}:${modelId}`,
    provider: provider.name,
    output: "text",
    reasoning: false,
    ...facts,
  });

describe("buildModelDescription", () => {
  it("keeps the model's listed facts apart from its transport and parser", () => {
    const description = listed(openrouter, "vendor/reader", {
      contextWindow: 128000,
      imageInput: true,
      nativeDocuments: false,
      reasoning: true,
    });

    expect(description).toEqual({
      id: "openrouter:vendor/reader",
      provider: "openrouter",
      modelId: "vendor/reader",
      listed: true,
      model: {
        output: "text",
        contextWindow: 128000,
        imageInput: true,
        nativeDocuments: false,
        reasoning: true,
      },
      transport: {
        type: "openai-compatible",
        endpoint: "openrouter",
        documents: ["application/pdf"],
      },
      parser: { documents: ["application/pdf"] },
    });
  });

  it("falls back to id-family facts for a model the listing doesn't carry", () => {
    expect(buildModelDescription(anthropic, "claude-opus-4-8", undefined)).toEqual({
      id: "anthropic:claude-opus-4-8",
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      listed: false,
      model: { output: "text", reasoning: true },
      transport: { type: "anthropic", endpoint: "anthropic", documents: ["application/pdf"] },
      parser: { documents: [] },
    });
  });
});

describe("acceptedDocuments", () => {
  it("accepts what the transport carries while the model isn't known to lack support", () => {
    expect(acceptedDocuments(listed(anthropic, "claude"))).toEqual(["application/pdf"]);
    expect(acceptedDocuments(listed(anthropic, "claude", { nativeDocuments: true }))).toEqual([
      "application/pdf",
    ]);
  });

  it("accepts a document the model can't read only where the endpoint parses it", () => {
    expect(acceptedDocuments(listed(openrouter, "plain", { nativeDocuments: false }))).toEqual([
      "application/pdf",
    ]);
    expect(acceptedDocuments(listed(anthropic, "claude", { nativeDocuments: false }))).toEqual([]);
  });

  it("accepts none where the transport carries none, or the model produces images", () => {
    expect(acceptedDocuments(listed(local, "gemma", { nativeDocuments: true }))).toEqual([]);
    expect(acceptedDocuments(listed(openrouter, "imagen", { output: "image" }))).toEqual([]);
  });
});

describe("toModelInfo", () => {
  it("exposes the public facts and the accepted documents, nothing execution-only", () => {
    const description = listed(anthropic, "claude", {
      contextWindow: 200000,
      outputLimit: 8192,
      imageInput: true,
      nativeDocuments: true,
      reasoning: true,
      reasoningLevels: ["low"],
    });

    expect(toModelInfo(description)).toEqual({
      id: "anthropic:claude",
      provider: "anthropic",
      contextWindow: 200000,
      outputLimit: 8192,
      output: "text",
      imageInput: true,
      documentInput: ["application/pdf"],
    });
  });

  it("omits documentInput when no document is accepted", () => {
    expect(toModelInfo(listed(local, "gemma"))).toEqual({
      id: "local:gemma",
      provider: "local",
      output: "text",
    });
  });
});
