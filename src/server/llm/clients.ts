import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import {
  type ImageModel,
  type ImagePart,
  type LanguageModel,
  type ModelMessage,
  type TranscriptionModel,
  generateText,
} from "ai";
import { type ModelCatalogue, createModelCatalogue } from "./catalogue.ts";
import { createCodexModel, generateCodexText } from "./codex-model.ts";
import { endpointFor } from "./endpoint.ts";
import {
  type LlmModelsResult,
  type ModelDescription,
  buildModelDescription,
} from "./model-description.ts";
import { createOpenRouterModel } from "./openrouter-model.ts";
import { type LlmProviderRegistry, createLlmProviderRegistry } from "./registry.ts";
import type { LlmProvider } from "./schema.ts";

/**
 * A constructed, ready-to-call language model. Opaque to callers — produced by
 * `resolveModel` and handed straight back to `generateLlmText`, so nothing
 * outside this module needs to import the AI SDK.
 */
export type LlmModel = LanguageModel;

/**
 * A constructed, ready-to-call image-generation model, produced by
 * `resolveImageModel` and handed to the AI SDK's `generateImage`.
 */
export type LlmImageModel = ImageModel;

/**
 * A constructed, ready-to-call speech-to-text model, produced by
 * `resolveTranscriptionModel` and handed to the AI SDK's `transcribe`.
 */
export type LlmTranscriptionModel = TranscriptionModel;

/** Token counts from a completed generation; a field is undefined when the provider omits it. */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** The text and token usage from a single completion. */
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
   * Build an image-generation model for a `provider:model` id. The same id
   * and registry contract as `resolveModel`; additionally throws for an
   * `anthropic` or `openai-codex` provider, which offers no image generation.
   */
  resolveImageModel(id: string): LlmImageModel;
  /**
   * Build a speech-to-text model for a `provider:model` id. The same id and
   * registry contract as `resolveModel`; additionally throws for an
   * `anthropic` or `openai-codex` provider, which offers no transcription.
   */
  resolveTranscriptionModel(id: string): LlmTranscriptionModel;
  /**
   * Resolve a `provider:model` id and run a single completion
   * against it. Resolution errors and provider/API errors both surface as a
   * rejection. The one operation the runner needs, on the one object it is
   * handed — so a test fake can stand in without touching the AI SDK.
   */
  generateText(options: {
    model: string;
    prompt: string;
    /** Images supplied after the prompt, in order, as native image input. */
    images?: ImagePart[];
    system?: string;
    abortSignal?: AbortSignal;
  }): Promise<GenerateLlmTextResult>;
  /**
   * Describe the models every configured provider currently offers, namespaced
   * as `provider:model` ids ready to hand back to `resolveModel`. A provider that
   * is down or unauthorised is collected as a failure, never fatal. Each call
   * discovers afresh and refreshes the cache execution reads, so a turn runs on
   * the facts the picker just showed. Lives here
   * so callers list models off the same object they resolve them through,
   * without touching the registry or AI SDK directly.
   */
  listModels(): Promise<LlmModelsResult>;
  /**
   * Describe a `provider:model` id: the model's facts, the transport that
   * carries requests to it, and what its endpoint parses for it. Reads the
   * model's own provider's listing — no other provider is asked — cached
   * briefly and refreshed by `listModels`, with discovery bounded so a hung
   * endpoint can't hold a turn. A model the listing doesn't carry — or whose
   * listing failed, or whose wait `signal` cut short — is described from its
   * id alone (`listed: false`) rather than failing. Registry replacement
   * starts a fresh cache; in-flight lookups retain their starting
   * configuration. Rejects for an id that doesn't resolve, matching
   * `resolveModel`.
   */
  describeModel(id: string, options?: { signal?: AbortSignal }): Promise<ModelDescription>;
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
  interface MetadataSnapshot {
    revision: number;
    registry: LlmProviderRegistry;
    catalogue: ModelCatalogue;
  }
  let metadata: MetadataSnapshot | undefined;
  const metadataSnapshot = (): MetadataSnapshot => {
    const revision = registry.revision();
    if (metadata === undefined || metadata.revision !== revision) {
      // Keep old lookups and already-built models on their original endpoints,
      // and start the new configuration on an empty catalogue.
      const snapshot = createLlmProviderRegistry();
      snapshot.replace(
        new Map(registry.listProviders().map((provider) => [provider.name, provider])),
      );
      metadata = { revision, registry: snapshot, catalogue: createModelCatalogue(env) };
    }
    return metadata;
  };
  // Describe a model from its own provider's listing — no other provider is asked.
  const describe = async (
    snapshot: MetadataSnapshot,
    id: string,
    signal?: AbortSignal,
  ): Promise<ModelDescription> => {
    const { provider, modelId } = resolveProvider(snapshot.registry, id);
    const { models } = await snapshot.catalogue.listing(provider, { signal });
    return buildModelDescription(
      provider,
      modelId,
      models.find((model) => model.id === id),
    );
  };

  const clients: LlmClients = {
    // `async` so a synchronous resolveModel throw (bad id, unknown
    // provider) reaches callers as a rejection, the same channel as a
    // provider/API error.
    async generateText(options) {
      return generateLlmText({
        model: clients.resolveModel(options.model),
        prompt: options.prompt,
        images: options.images,
        system: options.system,
        abortSignal: options.abortSignal,
      });
    },
    async listModels() {
      const { registry: providers, catalogue } = metadataSnapshot();
      const settled = await Promise.all(
        providers.listProviders().map(async (provider) => ({
          provider,
          listing: await catalogue.refresh(provider),
        })),
      );
      const result: LlmModelsResult = { models: [], failures: [] };
      for (const { provider, listing } of settled) {
        if (listing.reason !== undefined) {
          result.failures.push({ provider: provider.name, reason: listing.reason });
        }
        for (const listed of listing.models) {
          const modelId = listed.id.slice(provider.name.length + 1);
          result.models.push(buildModelDescription(provider, modelId, listed));
        }
      }
      return result;
    },
    async describeModel(id, { signal } = {}) {
      return describe(metadataSnapshot(), id, signal);
    },
    resolveModel(id) {
      const snapshot = metadataSnapshot();
      const { provider, modelId } = resolveProvider(snapshot.registry, id);
      const model = buildModel(provider, modelId, env);
      // Endpoint-specific request shaping wraps the generic model here, where
      // the model's description is in reach.
      return endpointFor(provider).kind === "openrouter"
        ? createOpenRouterModel(model, () => describe(snapshot, id))
        : model;
    },
    resolveImageModel(id) {
      const { provider, modelId } = resolveProvider(registry, id);
      return buildImageModel(provider, modelId, env);
    },
    resolveTranscriptionModel(id) {
      const { provider, modelId } = resolveProvider(registry, id);
      return buildTranscriptionModel(provider, modelId, env);
    },
  };
  return clients;
}

/** Split a `provider:model` id and look its provider up in the registry, throwing on either failure. */
function resolveProvider(
  registry: LlmProviderRegistry,
  id: string,
): { provider: LlmProvider; modelId: string } {
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

  return { provider, modelId };
}

/** Construct an AI SDK model for a resolved provider, reading its API key from `env` now. */
function buildModel(
  provider: LlmProvider,
  modelId: string,
  env: Record<string, string | undefined>,
): LanguageModelV3 {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  switch (provider.type) {
    case "openai-codex":
      return createCodexModel(modelId, provider.name, env);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: provider.baseUrl })(modelId);
    case "openai":
      // Chat Completions, not the SDK-default Responses API: it shares one
      // request shape with openai-compatible endpoints and is the portable
      // lowest common denominator for plain text completion.
      return createOpenAI({ apiKey, baseURL: provider.baseUrl }).chat(modelId);
    case "openai-compatible":
      // The schema requires `base_url` for an openai-compatible provider, so
      // it is always present. `includeUsage` opts into `stream_options: {
      // include_usage: true }` so streamed turns (sessions) report token
      // usage — unlike the `openai` provider, this one omits it by default,
      // which otherwise leaves every streamed session turn with zero token
      // counts.
      return createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseUrl as string,
        apiKey,
        includeUsage: true,
      })(modelId);
  }
}

/** Construct an AI SDK image model for a resolved provider, reading its API key from `env` now. */
function buildImageModel(
  provider: LlmProvider,
  modelId: string,
  env: Record<string, string | undefined>,
): LlmImageModel {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  switch (provider.type) {
    case "anthropic":
    case "openai-codex":
      throw new Error(
        `provider "${provider.name}" is ${provider.type}, which offers no image generation`,
      );
    case "openai":
      return createOpenAI({ apiKey, baseURL: provider.baseUrl }).imageModel(modelId);
    case "openai-compatible":
      // Calls the provider's OpenAI-style `/images/generations` endpoint —
      // OpenRouter and other gateways serve it alongside chat completions.
      return createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseUrl as string,
        apiKey,
      }).imageModel(modelId);
  }
}

/** Construct an AI SDK transcription model for a resolved provider, reading its API key from `env` now. */
function buildTranscriptionModel(
  provider: LlmProvider,
  modelId: string,
  env: Record<string, string | undefined>,
): LlmTranscriptionModel {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  switch (provider.type) {
    case "anthropic":
    case "openai-codex":
      throw new Error(
        `provider "${provider.name}" is ${provider.type}, which offers no transcription`,
      );
    case "openai":
      return createOpenAI({ apiKey, baseURL: provider.baseUrl }).transcription(modelId);
    case "openai-compatible":
      // The openai-compatible provider has no transcription model, but the
      // openai one only ever posts a `model` + `file` multipart form to
      // `<base_url>/audio/transcriptions` — the exact OpenAI-style contract
      // OpenRouter and local speech servers implement — so it serves here.
      // Unlike its openai-compatible sibling it insists on a key, so a
      // keyless local server gets an empty bearer it ignores.
      return createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: provider.baseUrl as string,
      }).transcription(modelId);
  }
}

/**
 * Run a single completion against a resolved model, returning the
 * generated text and token usage. Provider and API errors bubble unchanged.
 */
export async function generateLlmText(options: {
  model: LlmModel;
  prompt: string;
  images?: ImagePart[];
  system?: string;
  abortSignal?: AbortSignal;
}): Promise<GenerateLlmTextResult> {
  const generate =
    typeof options.model !== "string" && options.model.provider === "openai-codex"
      ? generateCodexText
      : generateText;
  const { text, usage } = await generate({
    model: options.model,
    prompt: options.images?.length
      ? ([
          { role: "user", content: [{ type: "text", text: options.prompt }, ...options.images] },
        ] satisfies ModelMessage[])
      : options.prompt,
    system: options.system,
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
