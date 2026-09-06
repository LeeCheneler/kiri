import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, streamText, wrapLanguageModel } from "ai";
import { CODEX_BASE_URL, createCodexFetch } from "./codex-fetch.ts";

/** Construct a stateless Responses model using the user's Codex CLI login. */
export function createCodexModel(
  modelId: string,
  providerName: string,
  env: Record<string, string | undefined>,
) {
  return wrapLanguageModel({
    providerId: "openai-codex",
    model: createOpenAI({
      apiKey: "unused",
      baseURL: CODEX_BASE_URL,
      fetch: createCodexFetch(env, providerName),
    }).responses(modelId),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            // The backend requires store:false. Encrypted reasoning lets later
            // turns replay reasoning without relying on server-side storage.
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      }),
    },
  });
}

/** Collect a streaming-only Codex response for completion-shaped utility calls. */
export async function generateCodexText(options: {
  model: LanguageModel;
  prompt: string;
  abortSignal?: AbortSignal;
}) {
  const result = streamText({
    ...options,
    // Errors are handled below; the SDK's default callback logs request data.
    onError: () => {},
  });
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
  }
  options.abortSignal?.throwIfAborted();
  return { text: await result.text, usage: await result.usage };
}
