import { describe, expect, it } from "bun:test";
import { type LlmEndpoint, endpointFor } from "./endpoint.ts";
import type { LlmProvider } from "./schema.ts";

const local: LlmProvider = {
  name: "local",
  type: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
};
const openrouter: LlmProvider = {
  name: "openrouter",
  type: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
};

describe("endpointFor", () => {
  it("names a first-party provider by its type and the documents its transport carries", () => {
    expect(endpointFor({ name: "chatgpt", type: "openai-codex" })).toEqual({
      kind: "openai-codex",
      documents: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
    });
    expect(endpointFor({ name: "openai", type: "openai" })).toEqual({
      kind: "openai",
      documents: ["application/pdf"],
    });
    expect(endpointFor({ name: "anthropic", type: "anthropic" })).toEqual({
      kind: "anthropic",
      documents: ["application/pdf"],
    });
  });

  it("recognises OpenRouter by its base URL and carries PDFs to it", () => {
    expect(endpointFor(openrouter)).toEqual({ kind: "openrouter", documents: ["application/pdf"] });
  });

  it("treats any other openai-compatible endpoint as custom, carrying no documents", () => {
    const custom: LlmEndpoint = { kind: "custom", documents: [] };
    expect(endpointFor(local)).toEqual(custom);
    expect(endpointFor({ ...local, baseUrl: "not a url" })).toEqual(custom);
    expect(endpointFor({ ...local, baseUrl: undefined })).toEqual(custom);
  });
});
