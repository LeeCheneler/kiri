import { z } from "zod";
import type { LlmProviderRegistry } from "./registry.ts";
import type { LlmProvider, ProviderType } from "./schema.ts";

/** Anthropic requires a version header on every request to its REST API. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Default models-endpoint base URL by type. `openai-compatible` has no default — its `base_url` is required. */
const DEFAULT_BASE_URL: Partial<Record<ProviderType, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/** What a model produces: a chat model's text, or generated images. */
export type LlmModelOutput = "text" | "image";

/** A model offered by a configured provider, namespaced as a `provider:model` id. */
export interface LlmModelInfo {
  /** `provider:model` id — ready to hand straight to `resolveModel`. */
  id: string;
  /** The provider the model came from (the `providers:` map key). */
  provider: string;
  /** Maximum context (input) tokens, when the provider's listing reports it. */
  contextWindow?: number;
  /** Maximum output tokens, when the provider's listing reports it. */
  outputLimit?: number;
  /** What the model produces. Models producing neither text nor images are never listed. */
  output: LlmModelOutput;
}

/** A provider whose model listing failed. Never fatal — collected, not thrown. */
export interface LlmModelsFailure {
  /** The provider that failed (the `providers:` map key). */
  provider: string;
  /** Human-readable reason. Never echoes a resolved API key value. */
  reason: string;
}

/** The aggregate of model listings across every configured provider. */
export interface LlmModelsResult {
  /** Every model offered, flattened and namespaced by provider. */
  models: LlmModelInfo[];
  /** One entry per provider whose listing failed; the rest still succeed. */
  failures: LlmModelsFailure[];
}

// A token limit is a positive number; anything else (absent, zero, a string,
// null) degrades to undefined rather than failing the entry, so one odd field
// never sinks a listing.
const tokenLimit = z.number().positive().optional().catch(undefined);

// Router pseudo-models (OpenRouter's `openrouter/auto` and friends) report an
// image output modality because they *may route* to an image-capable model.
// They are picked and used as ordinary chat models, so they stay text.
const ROUTER_ID_PREFIX = "openrouter/";

// Id families for listings that carry no modality metadata (OpenAI, and
// Google's or xAI's OpenAI-compatible endpoints, which name models by id
// alone). A family matches as a delimited id segment so e.g. `gpt-image-1`
// and `grok-2-image` match without `imagechat-llama` ever doing so.
const IMAGE_ID = /^dall-e|(^|[-_/.])(image|imagen)(?=[-_/.]|$)/i;
const NON_TEXT_ID =
  /(^|[-_/.])(whisper|tts|transcribe|realtime|audio|embed|embeddings?|rerank|moderation|sora|veo|lyria)(?=[-_/.]|$)/i;

// DeepInfra marks every model with `metadata.tags` ("chat", "image-gen", …).
const NON_TEXT_TAGS = new Set(["embed", "tts", "stt", "video-gen"]);

// Together-style listings carry a `type` tag. Anthropic's `type: "model"` is
// deliberately in neither set — an unrecognised value is no signal at all.
const TEXT_TYPES = new Set(["chat", "language", "code", "llm", "vlm"]);
const NON_TEXT_TYPES = new Set([
  "embedding",
  "embeddings",
  "moderation",
  "rerank",
  "audio",
  "transcribe",
  "tts",
  "video",
]);

// The arrow form ("text+image->text") predates `output_modalities` in
// OpenRouter-shaped listings; its right-hand side is the output list.
function parseModalityArrow(modality: string | undefined): string[] | undefined {
  const [inputs, outputs, rest] = modality?.split("->") ?? [];
  if (inputs === undefined || outputs === undefined || rest !== undefined) return undefined;
  return outputs
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
}

// What a listing entry may expose about its modality, whichever shape the
// provider uses. All fields are optional; classification tries each in turn.
interface ModalitySignals {
  id: string;
  architecture?: { output_modalities?: string[]; modality?: string };
  metadata?: { tags?: string[] };
  type?: string;
  capabilities?: { completion_chat?: boolean };
}

// Classify a listing entry by what it produces. Providers expose modality in
// different shapes, tried strongest-first: `architecture.output_modalities`
// or the arrow-form `architecture.modality` (OpenRouter and gateways copying
// its shape), `metadata.tags` (DeepInfra), a `type` tag (Together-style),
// `capabilities.completion_chat` (Mistral), then well-known id families for
// bare listings (OpenAI, Anthropic). Image wins over text: a model that can
// emit both exists to generate images. A model producing neither text nor
// images — audio, video, embeddings — is nothing kiri can drive, so it
// classifies as undefined and is dropped from the listing.
function classifyOutput(entry: ModalitySignals): LlmModelOutput | undefined {
  if (entry.id.startsWith(ROUTER_ID_PREFIX)) return "text";

  const modalities =
    entry.architecture?.output_modalities ?? parseModalityArrow(entry.architecture?.modality);
  if (modalities !== undefined && modalities.length > 0) {
    if (modalities.includes("image")) return "image";
    return modalities.every((modality) => modality === "text") ? "text" : undefined;
  }

  const tags = entry.metadata?.tags;
  if (tags !== undefined) {
    if (tags.includes("image-gen")) return "image";
    if (tags.includes("chat") || tags.includes("vlm")) return "text";
    if (tags.some((tag) => NON_TEXT_TAGS.has(tag))) return undefined;
  }

  if (entry.type !== undefined) {
    if (entry.type === "image") return "image";
    if (TEXT_TYPES.has(entry.type)) return "text";
    if (NON_TEXT_TYPES.has(entry.type)) return undefined;
  }

  if (entry.capabilities?.completion_chat !== undefined) {
    return entry.capabilities.completion_chat ? "text" : undefined;
  }

  if (IMAGE_ID.test(entry.id)) return "image";
  return NON_TEXT_ID.test(entry.id) ? undefined : "text";
}

// One entry from a provider's `GET /models` listing, normalised to an id, the
// limits it reports under whichever field names the provider uses, and whether
// it generates images. Context prefers the actually-served value (OpenRouter's
// `top_provider`, Anthropic's `max_input_tokens`) over a theoretical maximum.
// DeepInfra nests its limits under `metadata`; its `metadata.max_tokens` merely
// repeats the context length, so only `metadata.context_length` is read.
// Unknown keys are ignored.
const listingEntrySchema = z
  .object({
    id: z.string(),
    architecture: z
      .object({
        output_modalities: z.array(z.string()).optional().catch(undefined),
        modality: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    type: z.string().optional().catch(undefined),
    capabilities: z
      .object({ completion_chat: z.boolean().optional().catch(undefined) })
      .optional()
      .catch(undefined),
    top_provider: z
      .object({ context_length: tokenLimit, max_completion_tokens: tokenLimit })
      .optional()
      .catch(undefined),
    metadata: z
      .object({
        context_length: tokenLimit,
        tags: z.array(z.string()).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    max_input_tokens: tokenLimit,
    context_length: tokenLimit,
    max_model_len: tokenLimit,
    max_context_length: tokenLimit,
    context_window: tokenLimit,
    max_tokens: tokenLimit,
    max_output_tokens: tokenLimit,
    max_completion_tokens: tokenLimit,
  })
  .transform((entry) => ({
    id: entry.id,
    output: classifyOutput(entry),
    limits: {
      contextWindow:
        entry.top_provider?.context_length ??
        entry.max_input_tokens ??
        entry.context_length ??
        entry.max_model_len ??
        entry.max_context_length ??
        entry.context_window ??
        entry.metadata?.context_length,
      outputLimit:
        entry.top_provider?.max_completion_tokens ??
        entry.max_tokens ??
        entry.max_output_tokens ??
        entry.max_completion_tokens,
    },
  }));

// One entry from LM Studio's native `/api/v0/models`, which reports context where
// its OpenAI-compatible `/v1/models` does not. Prefers the loaded (served) length
// over the model's maximum.
const nativeEntrySchema = z
  .object({ id: z.string(), loaded_context_length: tokenLimit, max_context_length: tokenLimit })
  .transform((entry) => ({
    id: entry.id,
    contextWindow: entry.loaded_context_length ?? entry.max_context_length,
  }));

/** A `{ data: [...] }` listing of model entries; a non-array or non-object body reads as empty. */
const listingSchema = z
  .object({ data: z.array(z.unknown()).catch([]) })
  .catch({ data: [] })
  .transform((body) =>
    body.data.flatMap((entry) => {
      const parsed = listingEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** LM Studio's native `{ data: [...] }` listing, reduced to entries with a known context window. */
const nativeListingSchema = z
  .object({ data: z.array(z.unknown()).catch([]) })
  .catch({ data: [] })
  .transform((body) =>
    body.data.flatMap((entry) => {
      const parsed = nativeEntrySchema.safeParse(entry);
      if (!parsed.success || parsed.data.contextWindow === undefined) return [];
      return [{ id: parsed.data.id, contextWindow: parsed.data.contextWindow }];
    }),
  );

/** A model id from a provider's listing, with any limits the listing reported. */
type ProviderModel = z.infer<typeof listingEntrySchema>;

/**
 * List the models every configured provider offers, namespaced as `provider:model`.
 * Each provider's models endpoint is fetched concurrently and failures are
 * collected per provider rather than failing the whole aggregate — a provider
 * that is down or unauthorised becomes a `failures` entry, never an exception.
 * API keys are read from `env` at call time and sent as the provider's auth
 * header; their values are never returned or echoed in a failure reason. Each
 * model carries its context window and output cap when the provider's listing
 * reports them (Anthropic, OpenRouter, vLLM, DeepInfra, LM Studio all do); a
 * provider whose listing omits them — notably OpenAI — leaves those fields
 * undefined. Each model is classified by what it produces — text or images —
 * from its reported output modalities (OpenRouter) or its id (OpenAI); models
 * producing neither (audio, video) are left off the list entirely.
 */
export async function listLlmModels(
  registry: LlmProviderRegistry,
  env: Record<string, string | undefined>,
): Promise<LlmModelsResult> {
  const settled = await Promise.all(
    registry.listProviders().map((provider) => listProviderModels(provider, env)),
  );

  const models: LlmModelInfo[] = [];
  const failures: LlmModelsFailure[] = [];
  for (const { provider, entries, reason } of settled) {
    if (reason !== undefined) {
      failures.push({ provider: provider.name, reason });
      continue;
    }
    for (const entry of entries) {
      if (entry.output === undefined) continue;
      models.push({
        id: `${provider.name}:${entry.id}`,
        provider: provider.name,
        ...entry.limits,
        output: entry.output,
      });
    }
  }
  return { models, failures };
}

/**
 * Fetch one provider's `GET {base}/models` listing into model ids and their
 * reported limits, turning any failure (network, non-2xx, malformed body) into a
 * `reason` rather than a throw.
 */
async function listProviderModels(
  provider: LlmProvider,
  env: Record<string, string | undefined>,
): Promise<{ provider: LlmProvider; entries: ProviderModel[]; reason?: string }> {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  const { url, headers } = buildRequest(provider, apiKey);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const entries = listingSchema.parse(await response.json());

    // LM Studio's OpenAI-compatible /v1/models omits context; its native
    // /api/v0/models reports it. Probe that (best-effort) only when the primary
    // listing left context unknown, so a provider like OpenRouter that already
    // reports it never pays for the extra request.
    if (
      provider.type === "openai-compatible" &&
      provider.baseUrl &&
      entries.some((entry) => entry.limits.contextWindow === undefined)
    ) {
      const native = await fetchLmStudioContext(provider.baseUrl, headers);
      for (const entry of entries) {
        const contextWindow = native.get(entry.id);
        if (entry.limits.contextWindow === undefined && contextWindow !== undefined) {
          entry.limits = { ...entry.limits, contextWindow };
        }
      }
    }

    return { provider, entries };
  } catch (cause) {
    return {
      provider,
      entries: [],
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Best-effort fetch of LM Studio's native `/api/v0/models` listing. Returns a
 * model-id → context-window map. Any failure (not LM Studio, unreachable,
 * malformed) yields an empty map, so callers simply leave those models bare.
 */
async function fetchLmStudioContext(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<Map<string, number>> {
  try {
    const url = `${new URL(baseUrl).origin}/api/v0/models`;
    const response = await fetch(url, { headers });
    if (!response.ok) return new Map();
    const entries = nativeListingSchema.parse(await response.json());
    return new Map(entries.map((entry) => [entry.id, entry.contextWindow]));
  } catch {
    return new Map();
  }
}

/** Build the models-endpoint URL and auth headers for a provider. */
function buildRequest(
  provider: LlmProvider,
  apiKey: string | undefined,
): { url: string; headers: Record<string, string> } {
  const base = (provider.baseUrl ?? DEFAULT_BASE_URL[provider.type] ?? "").replace(/\/+$/, "");
  const url = `${base}/models`;

  if (provider.type === "anthropic") {
    const headers: Record<string, string> = { "anthropic-version": ANTHROPIC_VERSION };
    if (apiKey) headers["x-api-key"] = apiKey;
    return { url, headers };
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return { url, headers };
}
