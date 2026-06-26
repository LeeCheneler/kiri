import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, generateText } from "ai";
import { type LlmModelsResult, listLlmModels } from "./models.ts";
import type { LlmProviderRegistry } from "./registry.ts";
import type { LlmProvider } from "./schema.ts";

/**
 * A constructed, ready-to-call language model. Opaque to callers — produced by
 * `resolveModel` and handed straight back to `generateLlmText`, so nothing
 * outside this module needs to import the AI SDK.
 */
export type LlmModel = LanguageModel;

// How long a fetched model listing is reused for context-window lookups. A
// model's window is effectively constant, so a few minutes' cache spares a
// per-turn caller (the history cull check) from refetching every provider's
// listing on each turn, while staying short enough to pick up provider changes.
const MODEL_LISTING_TTL_MS = 5 * 60_000;

/** Token counts from a completed generation; a field is undefined when the provider omits it. */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** The text and token usage from a single non-streaming completion. */
export interface GenerateLlmTextResult {
  text: string;
  usage: LlmUsage;
}

/** Resolves `provider:model` ids against a provider registry into ready-to-call models. */
export interface LlmClients {
  /**
   * Build a model for a `provider:model` id (e.g. `anthropic:claude-haiku-4-5`).
   * Throws when the id isn't `provider:model` shaped, or names a provider absent
   * from the registry — the error lists the configured provider names.
   */
  resolveModel(id: string): LlmModel;
  /**
   * Resolve a `provider:model` id and run a single non-streaming completion
   * against it. Resolution errors and provider/API errors both surface as a
   * rejection. The one operation the runner needs, on the one object it is
   * handed — so a test fake can stand in without touching the AI SDK.
   */
  generateText(options: {
    model: string;
    prompt: string;
    abortSignal?: AbortSignal;
  }): Promise<GenerateLlmTextResult>;
  /**
   * List the models every configured provider currently offers, namespaced as
   * `provider:model` ids ready to hand back to `resolveModel`. A provider that
   * is down or unauthorised is collected as a failure, never fatal. Lives here
   * so callers list models off the same object they resolve them through,
   * without touching the registry or AI SDK directly.
   */
  listModels(): Promise<LlmModelsResult>;
  /**
   * The context window (max input tokens) for a `provider:model` id, or
   * undefined when the model isn't listed or its provider doesn't report one.
   * Reads the same provider listings as `listModels`, cached briefly so a
   * per-turn caller doesn't refetch every provider each turn. A provider whose
   * listing fails simply contributes no models, so its windows read as unknown
   * rather than failing the lookup.
   */
  contextWindowFor(id: string): Promise<number | undefined>;
}

/**
 * Create the LLM client resolver over a provider registry. API keys are read
 * from `env` when a model is resolved and handed straight to the AI SDK
 * provider — never written back onto the registry entries.
 */
export function createLlmClients(
  registry: LlmProviderRegistry,
  env: Record<string, string | undefined>,
): LlmClients {
  // Cache the listing for context-window lookups only; `listModels` stays
  // uncached so the model picker always reflects the configured providers.
  let listingCache: { at: number; promise: Promise<LlmModelsResult> } | undefined;
  const cachedListing = (): Promise<LlmModelsResult> => {
    if (listingCache === undefined || Date.now() - listingCache.at >= MODEL_LISTING_TTL_MS) {
      listingCache = { at: Date.now(), promise: listLlmModels(registry, env) };
    }
    return listingCache.promise;
  };

  const clients: LlmClients = {
    // `async` so a synchronous resolveModel throw (bad id, unknown
    // provider) reaches callers as a rejection, the same channel as a
    // provider/API error.
    async generateText(options) {
      return generateLlmText({
        model: clients.resolveModel(options.model),
        prompt: options.prompt,
        abortSignal: options.abortSignal,
      });
    },
    listModels() {
      return listLlmModels(registry, env);
    },
    async contextWindowFor(id) {
      const { models } = await cachedListing();
      return models.find((model) => model.id === id)?.contextWindow;
    },
    resolveModel(id) {
      const separator = id.indexOf(":");
      const providerName = separator === -1 ? id : id.slice(0, separator);
      const modelId = separator === -1 ? "" : id.slice(separator + 1);
      if (!providerName || !modelId) {
        throw new Error(`invalid llm model id "${id}" — expected "provider:model" form`);
      }

      const provider = registry.getProvider(providerName);
      if (!provider) {
        const known = registry.listProviders().map((p) => p.name);
        throw new Error(
          `unknown llm provider "${providerName}" — configured providers: ${
            known.length > 0 ? known.join(", ") : "(none)"
          }`,
        );
      }

      return buildModel(provider, modelId, env);
    },
  };
  return clients;
}

/** Construct an AI SDK model for a resolved provider, reading its API key from `env` now. */
function buildModel(
  provider: LlmProvider,
  modelId: string,
  env: Record<string, string | undefined>,
): LlmModel {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  switch (provider.type) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: provider.baseUrl })(modelId);
    case "openai":
      // Chat Completions, not the SDK-default Responses API: it shares one
      // request shape with openai-compatible endpoints and is the portable
      // lowest common denominator for plain text completion.
      return createOpenAI({ apiKey, baseURL: provider.baseUrl }).chat(modelId);
    case "openai-compatible":
      // The schema requires `base_url` for this type, so it is always present.
      // `includeUsage` opts into `stream_options: { include_usage: true }` so
      // streamed turns (sessions) report token usage — unlike the `openai`
      // provider, this one omits it by default, which otherwise leaves every
      // streamed session turn with zero token counts.
      return createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseUrl as string,
        apiKey,
        includeUsage: true,
      })(modelId);
  }
}

/**
 * Run a single non-streaming completion against a resolved model, returning the
 * generated text and token usage. Provider and API errors bubble unchanged.
 */
export async function generateLlmText(options: {
  model: LlmModel;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<GenerateLlmTextResult> {
  const { text, usage } = await generateText({
    model: options.model,
    prompt: options.prompt,
    abortSignal: options.abortSignal,
  });
  return {
    text,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    },
  };
}
