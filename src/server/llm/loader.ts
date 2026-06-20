import { existsSync, readFileSync } from "node:fs";
import type { ConfigStore } from "../config/store.ts";
import { type LlmProvider, type ProviderType, llmProvidersSchema } from "./schema.ts";

/**
 * Conventional environment variable an `api_key`-less provider falls back to,
 * by type. `openai-compatible` has no convention and needs no key.
 */
const CONVENTIONAL_API_KEY_ENV: Partial<Record<ProviderType, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** A failure loading `llm-providers.yaml` — read, parse, validation, or env-ref. */
export interface LlmProvidersLoadFailure {
  /** Absolute path of the config file. */
  path: string;
  /** Human-readable reason. Never echoes a resolved secret value. */
  reason: string;
}

export interface LlmProvidersLoadResult {
  /** Providers keyed by `name`. Empty when the file is absent or failed to load. */
  providers: Map<string, LlmProvider>;
  /** Set when a present file failed to load. An absent file is not a failure. */
  failure?: LlmProvidersLoadFailure;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Load the workspace's `llm-providers.yaml` and resolve it into providers keyed by name.
 * An absent file is first-class: an empty registry, not a failure. A present
 * file that fails to read, parse, or validate — or whose declared `{ env: }`
 * refs name a variable missing from `env` — yields an empty registry plus a
 * `failure` describing why, the same posture as a workflow that can't load.
 * Only declared refs are presence-checked; conventional fallbacks resolve at
 * use time. Resolved key *values* are never read or stored — the registry keeps
 * only the env var's name.
 */
export function loadLlmProviders(
  config: ConfigStore,
  env: Record<string, string | undefined>,
): LlmProvidersLoadResult {
  const path = config.providersFile();
  const providers = new Map<string, LlmProvider>();

  if (!existsSync(path)) return { providers };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return { providers, failure: { path, reason: reasonOf(cause) } };
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (cause) {
    return { providers, failure: { path, reason: reasonOf(cause) } };
  }

  const result = llmProvidersSchema.safeParse(parsed);
  if (!result.success) {
    return { providers, failure: { path, reason: result.error.message } };
  }

  const missing: string[] = [];
  for (const [name, entry] of Object.entries(result.data.providers ?? {})) {
    if (entry.api_key && env[entry.api_key.env] === undefined) {
      missing.push(`"${name}" → ${entry.api_key.env}`);
      continue;
    }
    providers.set(name, {
      name,
      type: entry.type,
      baseUrl: entry.base_url,
      apiKeyEnv: entry.api_key?.env ?? CONVENTIONAL_API_KEY_ENV[entry.type],
    });
  }

  if (missing.length > 0) {
    const noun = missing.length === 1 ? "var" : "vars";
    return {
      providers: new Map(),
      failure: {
        path,
        reason: `unresolved api_key env ${noun}: ${missing.join(", ")} (not set in the kiri process environment)`,
      },
    };
  }

  return { providers };
}
