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

/**
 * List the models every configured provider offers, namespaced as `provider:model`.
 * Each provider's models endpoint is fetched concurrently and failures are
 * collected per provider rather than failing the whole aggregate — a provider
 * that is down or unauthorised becomes a `failures` entry, never an exception.
 * API keys are read from `env` at call time and sent as the provider's auth
 * header; their values are never returned or echoed in a failure reason. Each
 * model carries its context window and output cap when the provider's listing
 * reports them (Anthropic, OpenRouter, vLLM, LM Studio all do); a provider whose
 * listing omits them — notably OpenAI — leaves those fields undefined.
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

/** A model id from a provider's listing, with any limits the listing reported. */
interface ProviderModel {
  id: string;
  limits: { contextWindow?: number; outputLimit?: number };
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
    const body = (await response.json()) as { data?: unknown };
    const entries = (Array.isArray(body.data) ? body.data : [])
      .filter(isRecord)
      .filter(
        (entry): entry is Record<string, unknown> & { id: string } => typeof entry.id === "string",
      )
      .map((entry) => ({ id: entry.id, limits: extractLimits(entry) }));
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
 * Pull a model's context window and output cap from its listing entry, checking
 * the field names different providers use. Context prefers the actually-served
 * limit (`top_provider.context_length`, `max_input_tokens`) over a theoretical
 * maximum; non-positive or non-numeric values are ignored.
 */
function extractLimits(entry: Record<string, unknown>): ProviderModel["limits"] {
  const top = isRecord(entry.top_provider) ? entry.top_provider : {};
  const contextWindow = firstPositive(
    top.context_length,
    entry.max_input_tokens,
    entry.context_length,
    entry.max_model_len,
    entry.max_context_length,
    entry.context_window,
  );
  const outputLimit = firstPositive(
    top.max_completion_tokens,
    entry.max_tokens,
    entry.max_output_tokens,
    entry.max_completion_tokens,
  );
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(outputLimit !== undefined ? { outputLimit } : {}),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The first argument that is a finite number greater than zero, else undefined. */
const firstPositive = (...values: unknown[]): number | undefined =>
  values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );

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
