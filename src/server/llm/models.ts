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
 * header; their values are never returned or echoed in a failure reason.
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
  for (const { provider, ids, reason } of settled) {
    if (reason !== undefined) {
      failures.push({ provider: provider.name, reason });
      continue;
    }
    for (const id of ids) {
      models.push({ id: `${provider.name}:${id}`, provider: provider.name });
    }
  }
  return { models, failures };
}

/**
 * Fetch one provider's `GET {base}/models` listing into model ids, turning any
 * failure (network, non-2xx, malformed body) into a `reason` rather than a throw.
 */
async function listProviderModels(
  provider: LlmProvider,
  env: Record<string, string | undefined>,
): Promise<{ provider: LlmProvider; ids: string[]; reason?: string }> {
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined;
  const { url, headers } = buildRequest(provider, apiKey);

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string");
    return { provider, ids };
  } catch (cause) {
    return { provider, ids: [], reason: cause instanceof Error ? cause.message : String(cause) };
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
