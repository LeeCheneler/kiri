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

// One entry from a provider's `GET /models` listing, normalised to an id and the
// limits it reports under whichever field names the provider uses. Context
// prefers the actually-served value (OpenRouter's `top_provider`, Anthropic's
// `max_input_tokens`) over a theoretical maximum. DeepInfra nests its limits
// under `metadata`; its `metadata.max_tokens` merely repeats the context
// length, so only `metadata.context_length` is read. Unknown keys are ignored.
const listingEntrySchema = z
  .object({
    id: z.string(),
    top_provider: z
      .object({ context_length: tokenLimit, max_completion_tokens: tokenLimit })
      .optional()
      .catch(undefined),
    metadata: z.object({ context_length: tokenLimit }).optional().catch(undefined),
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
 * undefined.
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
      models.push({ id: `${provider.name}:${entry.id}`, provider: provider.name, ...entry.limits });
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
