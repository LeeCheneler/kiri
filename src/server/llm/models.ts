import { z } from "zod";
import type { ModelInfo } from "../../shared/api/models.ts";
import { CODEX_BASE_URL, createCodexFetch } from "./codex-fetch.ts";
import { endpointFor } from "./endpoint.ts";
import type { LlmProvider, ProviderType } from "./schema.ts";

/** Anthropic requires a version header on every request to its REST API. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Default models-endpoint base URL by type. `openai-compatible` has no default — its `base_url` is required. */
const DEFAULT_BASE_URL: Partial<Record<ProviderType, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/**
 * What a provider's listing says about one model — facts about the model
 * itself, never about the transport that carries requests to it.
 */
export interface ListedModel {
  /** `provider:model` id. */
  id: string;
  /** The provider the model came from. */
  provider: string;
  /** Maximum context (input) tokens, when the listing reports it. */
  contextWindow?: number;
  /** Maximum output tokens, when the listing reports it. */
  outputLimit?: number;
  /** What the model produces. Models producing neither text nor images are never listed. */
  output: LlmModelOutput;
  /** Whether the model accepts image input; absent when the listing doesn't say. */
  imageInput?: boolean;
  /**
   * Whether the model reads documents natively, when its listing reports
   * input modalities (OpenRouter's does); absent when it doesn't say.
   */
  nativeDocuments?: boolean;
  /**
   * Whether the model supports reasoning parameters (an effort or
   * reasoning-effort setting). Heuristic: read from the listing's supported
   * parameters when reported, otherwise from well-known id families — and
   * false when neither says yes, so nothing is ever sent blind.
   */
  reasoning: boolean;
  /** Server-side effort levels advertised by Codex, ordered by capability at use. */
  reasoningLevels?: string[];
}

/** What a listed model produces. */
export type LlmModelOutput = ModelInfo["output"];

/** One provider's listing: the models it offers, or why discovery failed. */
export interface ProviderListing {
  /** Every model the provider offers, namespaced by it; empty when discovery failed. */
  models: ListedModel[];
  /** Why discovery failed; absent on success. Never carries key material. */
  reason?: string;
}

/** How long one provider's discovery — its listing and any follow-up probe — may take. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

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

// Reasoning-capable id families for listings that carry no parameter
// metadata, matched as delimited id segments like the image families:
// OpenAI's o-series and gpt-5 generation, and models whose id names reasoning
// outright (deepseek-r1, qwen's qwq, mistral's magistral, "-thinking"
// variants). Anthropic ids are handled separately below.
const REASONING_ID =
  /(^|[-_/.])(o[134]|gpt-5(?:\.\d+)?|qwq|magistral|r1|deepseek-reasoner|thinking|reasoning)(?=[-_/.]|$)/i;

// Id families that look reasoning-shaped but reject reasoning parameters:
// the early o1 variants, and the non-reasoning gpt-5 chat models.
const NON_REASONING_ID = /(^|[-_/.])(o1-(mini|preview)|gpt-5(?:\.\d+)?-chat)(?=[-_/.]|$)/i;

// Anthropic ids: extended thinking arrived with claude-3-7, so every claude
// model except the known earlier families (claude-2, instant, the 3 and 3.5
// generations) classifies as reasoning-capable — including future ones.
const CLAUDE_ID = /(^|[-_/.])claude(?=[-_/.]|$)/i;
const CLAUDE_NON_THINKING =
  /(^|[-_/.])claude[-.](instant|[12]|3[-.](5|haiku|opus|sonnet))(?=[-_/.]|$)/i;

// The arrow form ("text+image->text") predates the modality arrays in
// OpenRouter-shaped listings; the left-hand side lists inputs, the right outputs.
function parseModalityArrow(
  modality: string | undefined,
): { inputs: string[]; outputs: string[] } | undefined {
  const [inputs, outputs, rest] = modality?.split("->") ?? [];
  if (inputs === undefined || outputs === undefined || rest !== undefined) return undefined;
  const parts = (side: string) =>
    side
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== "");
  return { inputs: parts(inputs), outputs: parts(outputs) };
}

// What a listing entry may expose about its modality, whichever shape the
// provider uses. All fields are optional; classification tries each in turn.
interface ModalitySignals {
  id: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; modality?: string };
  metadata?: { tags?: string[] };
  type?: string;
  capabilities?: {
    completion_chat?: boolean;
    vision?: boolean;
    image_input?: { supported?: boolean };
  };
  supported_parameters?: string[];
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
    entry.architecture?.output_modalities ??
    parseModalityArrow(entry.architecture?.modality)?.outputs;
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

// Classify whether a listing entry accepts image (vision) input. Input signals
// are sparser than output ones: OpenRouter-shaped listings report
// `architecture.input_modalities` (or the arrow form's left-hand side),
// Anthropic reports `capabilities.image_input.supported`, Mistral
// `capabilities.vision`, and DeepInfra tags vision chat models "vlm" (as does
// a Together-style `type`). A bare listing (notably OpenAI's) carries no input
// signal at all, so the answer is undefined — unknown rather than false; only
// an explicit provider signal may say no.
function classifyImageInput(entry: ModalitySignals): boolean | undefined {
  const modalities =
    entry.architecture?.input_modalities ??
    parseModalityArrow(entry.architecture?.modality)?.inputs;
  if (modalities !== undefined && modalities.length > 0) return modalities.includes("image");

  const imageInput = entry.capabilities?.image_input?.supported;
  if (imageInput !== undefined) return imageInput;

  const vision = entry.capabilities?.vision;
  if (vision !== undefined) return vision;

  if (entry.metadata?.tags?.includes("vlm") || entry.type === "vlm") return true;
  return undefined;
}

// Classify whether a listing entry reads documents natively, from the same
// input-modality signals as images (OpenRouter's `file` modality). No
// modality signal at all is unknown, not false.
function classifyDocumentInput(entry: ModalitySignals): boolean | undefined {
  const modalities =
    entry.architecture?.input_modalities ??
    parseModalityArrow(entry.architecture?.modality)?.inputs;
  if (modalities !== undefined && modalities.length > 0) return modalities.includes("file");
  return undefined;
}

// Classify whether a listing entry supports reasoning parameters. An
// OpenRouter-shaped `supported_parameters` array is authoritative either way:
// it enumerates exactly what the endpoint accepts, so an entry that carries
// one without a reasoning parameter is a definite no. Bare listings (OpenAI,
// Anthropic) fall back to well-known id families, exclusions first — and a
// model with no signal at all classifies as false, never a guess, so effort
// parameters are only ever sent where the model is known to take them.
function classifyReasoning(entry: ModalitySignals): boolean {
  const params = entry.supported_parameters;
  if (params !== undefined) {
    return ["reasoning", "reasoning_effort", "include_reasoning"].some((param) =>
      params.includes(param),
    );
  }
  if (NON_REASONING_ID.test(entry.id)) return false;
  if (CLAUDE_ID.test(entry.id)) return !CLAUDE_NON_THINKING.test(entry.id);
  return REASONING_ID.test(entry.id);
}

// One entry from a provider's `GET /models` listing, normalised to an id, the
// limits it reports under whichever field names the provider uses, whether it
// generates images, and whether it accepts image input when the listing says.
// Context prefers the actually-served value (OpenRouter's
// `top_provider`, Anthropic's `max_input_tokens`) over a theoretical maximum.
// DeepInfra nests its limits under `metadata`; its `metadata.max_tokens` merely
// repeats the context length, so only `metadata.context_length` is read.
// Unknown keys are ignored.
const listingEntrySchema = z
  .object({
    id: z.string(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional().catch(undefined),
        output_modalities: z.array(z.string()).optional().catch(undefined),
        modality: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    type: z.string().optional().catch(undefined),
    capabilities: z
      .object({
        completion_chat: z.boolean().optional().catch(undefined),
        vision: z.boolean().optional().catch(undefined),
        image_input: z
          .object({ supported: z.boolean().optional().catch(undefined) })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
    supported_parameters: z.array(z.string()).optional().catch(undefined),
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
    imageInput: classifyImageInput(entry),
    nativeDocuments: classifyDocumentInput(entry),
    reasoning: classifyReasoning(entry),
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
type ProviderModel = z.infer<typeof listingEntrySchema> & { reasoningLevels?: string[] };

// The Codex backend requires a client version; pinned to the verified protocol.
const CODEX_CLIENT_VERSION = "0.153.4";
const codexListingEntrySchema = z.object({
  slug: z.string().min(1),
  visibility: z.literal("list"),
  context_window: tokenLimit,
  input_modalities: z.array(z.string()).optional(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional(),
});
const codexListingSchema = z
  .object({ models: z.array(z.unknown()) })
  .transform((body): ProviderModel[] =>
    body.models.flatMap((entry) => {
      const parsed = codexListingEntrySchema.safeParse(entry);
      if (!parsed.success) return [];
      const model = parsed.data;
      const reasoningLevels = model.supported_reasoning_levels?.map((level) => level.effort) ?? [];
      return [
        {
          id: model.slug,
          output: "text" as const,
          imageInput: model.input_modalities?.includes("image"),
          // Documents reach the Codex backend by provider rule, not by listing.
          nativeDocuments: undefined,
          reasoning: reasoningLevels.some((level) => level !== "none"),
          reasoningLevels,
          limits: { contextWindow: model.context_window, outputLimit: undefined },
        },
      ];
    }),
  );

// A listing entry as the model facts it reports, namespaced by its provider.
function listedModel(
  provider: LlmProvider,
  entry: ProviderModel,
  output: LlmModelOutput,
): ListedModel {
  return {
    id: `${provider.name}:${entry.id}`,
    provider: provider.name,
    ...entry.limits,
    output,
    imageInput: entry.imageInput,
    ...(entry.nativeDocuments !== undefined ? { nativeDocuments: entry.nativeDocuments } : {}),
    reasoning: entry.reasoning,
    ...(entry.reasoningLevels !== undefined ? { reasoningLevels: entry.reasoningLevels } : {}),
  };
}

/**
 * The facts for a model its provider's listing doesn't carry — the listing
 * failed or is incomplete, or a custom endpoint serves none — read from the
 * id alone, by the same well-known families a bare listing falls back to.
 * Limits and input capabilities stay unknown, reasoning is claimed only for
 * a recognised family, and an id that names no output reads as text: a model
 * being described is one a session is about to drive.
 */
export function unlistedModel(provider: LlmProvider, modelId: string): ListedModel {
  const entry = listingEntrySchema.parse({ id: modelId });
  return listedModel(provider, entry, entry.output ?? "text");
}

/**
 * Discover the models one provider offers, namespaced as `provider:model`.
 * Any failure — network, non-2xx, malformed body, or discovery outlasting
 * `timeoutMs` — becomes a `reason`, never an exception. The API key is read
 * from `env` at call time and sent as the provider's auth header; its value
 * is never returned or echoed in a failure reason. Each model carries its
 * context window and output cap when the listing reports them (Anthropic,
 * OpenRouter, vLLM, DeepInfra, LM Studio all do); a listing that omits them —
 * notably OpenAI's — leaves those fields undefined. Each model is classified
 * by what it produces — text or images — from its reported output modalities
 * (OpenRouter) or its id (OpenAI); models producing neither (audio, video)
 * are left off entirely. Whether a model accepts image input is read from the
 * listing's input modalities or capability flags when present; a listing that
 * says nothing (OpenAI) leaves `imageInput` undefined — unknown, not false.
 * Whether a model supports reasoning parameters is read from the listing's
 * supported parameters (OpenRouter) or well-known id families (OpenAI,
 * Anthropic), defaulting to false when neither says yes.
 */
export async function listProviderModels(
  provider: LlmProvider,
  env: Record<string, string | undefined>,
  options: { timeoutMs?: number } = {},
): Promise<ProviderListing> {
  try {
    // One deadline covers the whole discovery, follow-up probe included.
    const signal = AbortSignal.timeout(options.timeoutMs ?? DISCOVERY_TIMEOUT_MS);
    const entries = await fetchProviderEntries(provider, env, signal);
    return {
      models: entries.flatMap((entry) =>
        entry.output === undefined ? [] : [listedModel(provider, entry, entry.output)],
      ),
    };
  } catch (cause) {
    return { models: [], reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

// Fetch and parse one provider's `GET {base}/models` listing, throwing on any failure.
async function fetchProviderEntries(
  provider: LlmProvider,
  env: Record<string, string | undefined>,
  signal: AbortSignal,
): Promise<ProviderModel[]> {
  if (provider.type === "openai-codex") {
    const response = await createCodexFetch(env, provider.name)(
      `${CODEX_BASE_URL}/models?client_version=${CODEX_CLIENT_VERSION}`,
      { signal },
    );
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return codexListingSchema.parse(await response.json());
  }

  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  const { url, headers } = buildRequest(provider, apiKey);
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  const entries = listingSchema.parse(await response.json());

  // LM Studio's OpenAI-compatible /v1/models omits context; its native
  // /api/v0/models reports it. Probe that (best-effort) on a custom endpoint
  // only when the primary listing left context unknown, so a server that
  // already reports it never pays for the extra request.
  if (
    endpointFor(provider).kind === "custom" &&
    provider.baseUrl &&
    entries.some((entry) => entry.limits.contextWindow === undefined)
  ) {
    const native = await fetchLmStudioContext(provider.baseUrl, headers, signal);
    for (const entry of entries) {
      const contextWindow = native.get(entry.id);
      if (entry.limits.contextWindow === undefined && contextWindow !== undefined) {
        entry.limits = { ...entry.limits, contextWindow };
      }
    }
  }
  return entries;
}

/**
 * Best-effort fetch of LM Studio's native `/api/v0/models` listing. Returns a
 * model-id → context-window map. Any failure (not LM Studio, unreachable,
 * malformed, out of time) yields an empty map, so callers simply leave those models bare.
 */
async function fetchLmStudioContext(
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Map<string, number>> {
  try {
    const url = `${new URL(baseUrl).origin}/api/v0/models`;
    const response = await fetch(url, { headers, signal });
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
