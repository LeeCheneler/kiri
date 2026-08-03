import type { LlmClients } from "../llm/index.ts";
import type { KiriConfigLoadResult } from "./loader.ts";
import type { ModelsConfig } from "./schema.ts";

/** Severity of a config check: wired correctly, working-but-reduced, or broken. */
export type ConfigCheckLevel = "ok" | "degraded" | "error";

/** The configuration concern a check reports on. */
export type ConfigArea = "config" | "providers" | "mcp" | "models";

/** A single configuration-health finding. */
export interface ConfigCheck {
  area: ConfigArea;
  level: ConfigCheckLevel;
  /** Short headline for the finding. */
  title: string;
  /** One-line explanation, including the next step when something's off. */
  detail: string;
}

/** The aggregate configuration-health report. */
export interface ConfigHealth {
  checks: ConfigCheck[];
}

// A configured model reference and where it's declared, labelled by its
// kiri.yaml path (`shortcuts.text.sonnet`, `delegates.daily`) so a finding
// points straight at the line to fix.
interface ModelReference {
  label: string;
  ref: string;
}

const modelReferences = (models: ModelsConfig): ModelReference[] => [
  ...Object.entries(models.shortcuts.text ?? {}).map(([name, ref]) => ({
    label: `shortcuts.text.${name}`,
    ref,
  })),
  ...Object.entries(models.shortcuts.image ?? {}).map(([name, ref]) => ({
    label: `shortcuts.image.${name}`,
    ref,
  })),
  ...Object.entries(models.delegates).map(([role, ref]) => ({
    label: `delegates.${role}`,
    ref,
  })),
];

// The provider prefix of a well-formed `provider:model` reference, or null
// when the reference isn't in that form at all.
const providerOf = (ref: string): string | null => {
  const split = ref.indexOf(":");
  return split > 0 && split < ref.length - 1 ? ref.slice(0, split) : null;
};

/**
 * Classify a workspace's configuration into ok / degraded / error checks from
 * an already-loaded {@link KiriConfigLoadResult} and the process environment.
 * Pure: no disk, no console — the single source of truth both the CLI boot
 * report and `GET /api/config/health` render. "Required" is contextual: no
 * providers is *degraded* (sh/use workflows still run), a declared provider with
 * a missing API key is an *error*, and an MCP server whose declared env ref is
 * unset is an *error*. Never inspects a resolved key value, only its presence.
 */
export function evaluateConfigHealth(input: {
  kiriConfig: KiriConfigLoadResult;
  env: Record<string, string | undefined>;
}): ConfigHealth {
  const { kiriConfig, env } = input;
  const checks: ConfigCheck[] = [];

  // Config file: only worth a line when something's off — a clean (or absent)
  // file is implied by the provider checks below.
  if (kiriConfig.failure) {
    checks.push({
      area: "config",
      level: "error",
      title: "kiri.yaml failed to load",
      detail: kiriConfig.failure.reason,
    });
  } else if (kiriConfig.warning) {
    checks.push({
      area: "config",
      level: "degraded",
      title: "Duplicate config file",
      detail: kiriConfig.warning,
    });
  }

  // Providers. A failed config load already explains the empty registry, so
  // skip the provider summary in that case rather than emit a redundant line.
  if (!kiriConfig.failure) {
    const providers = [...kiriConfig.providers.values()];
    if (providers.length === 0) {
      checks.push({
        area: "providers",
        level: "degraded",
        title: "No LLM providers configured",
        detail:
          "Agentic sessions and `llm:` workflow steps are unavailable; `sh:` and `use:` workflows still run. Declare a provider in kiri.yaml to enable them.",
      });
    } else {
      checks.push({
        area: "providers",
        level: "ok",
        title: `${providers.length} LLM provider${providers.length === 1 ? "" : "s"} configured`,
        detail: providers.map((p) => p.name).join(", "),
      });
      for (const provider of providers) {
        // A declared `{ env: }` ref is already presence-checked by the loader, so
        // a resolved provider can only be missing a key via the conventional
        // fallback (ANTHROPIC_API_KEY / OPENAI_API_KEY). Keyless providers
        // (openai-compatible with no api_key) carry no apiKeyEnv and need no check.
        if (provider.apiKeyEnv && env[provider.apiKeyEnv] === undefined) {
          checks.push({
            area: "providers",
            level: "error",
            title: `${provider.name}: ${provider.apiKeyEnv} is not set`,
            detail: `Provider "${provider.name}" cannot authenticate until ${provider.apiKeyEnv} is set in the environment.`,
          });
        }
      }
    }
  }

  // MCP servers: silent when none are configured (an opt-in capability), an ok
  // summary when present, and a per-server error when a declared env ref is
  // unset. A failed config load already explains the empty maps, so skip it.
  if (!kiriConfig.failure) {
    const servers = [...kiriConfig.mcp.values()];
    if (servers.length > 0) {
      checks.push({
        area: "mcp",
        level: "ok",
        title: `${servers.length} MCP server${servers.length === 1 ? "" : "s"} configured`,
        detail: servers.map((s) => s.name).join(", "),
      });
    }
    for (const { name, missing } of kiriConfig.mcpUnresolved) {
      const vars = missing.join(", ");
      const verb = missing.length === 1 ? "is" : "are";
      checks.push({
        area: "mcp",
        level: "error",
        title: `${name}: ${vars} not set`,
        detail: `MCP server "${name}" is unavailable until ${vars} ${verb} set in the environment.`,
      });
    }
  }

  // Model shortcuts and delegates: silent when none are configured, an ok
  // summary when present, and a per-reference error when one can't resolve
  // against the configured providers — a picker pin or delegate role that
  // 400s the moment it's used. Listing-level checks (a model the provider no
  // longer offers) live in evaluateModelListingHealth instead: they need the
  // live listing, and this evaluation stays pure. A failed config load
  // already explains the empty maps, so skip it.
  if (!kiriConfig.failure) {
    const refs = modelReferences(kiriConfig.models);
    if (refs.length > 0) {
      checks.push({
        area: "models",
        level: "ok",
        title: `${refs.length} model reference${refs.length === 1 ? "" : "s"} configured`,
        detail: refs.map((r) => r.label).join(", "),
      });
      for (const { label, ref } of refs) {
        const provider = providerOf(ref);
        if (provider === null) {
          checks.push({
            area: "models",
            level: "error",
            title: `${label}: not a provider:model reference`,
            detail: `"${ref}" must reference a model as \`provider:model\`, e.g. anthropic:claude-haiku-4-5.`,
          });
        } else if (!kiriConfig.providers.has(provider)) {
          const configured = [...kiriConfig.providers.keys()];
          checks.push({
            area: "models",
            level: "error",
            title: `${label}: unknown provider "${provider}"`,
            detail:
              configured.length > 0
                ? `"${ref}" needs provider "${provider}" declared in kiri.yaml — configured: ${configured.join(", ")}.`
                : `"${ref}" needs provider "${provider}" declared under providers: in kiri.yaml.`,
          });
        }
      }
    }
  }

  return { checks };
}

/**
 * Listing-level model checks for `GET /api/config/health`: a shortcut or
 * delegate whose provider resolves but whose model id the provider's listing
 * doesn't carry. Degraded rather than error — listings can be stale or
 * incomplete (some OpenAI-compatible endpoints list unreliably), and the
 * reference may still work at use. References whose provider is unknown or
 * malformed are {@link evaluateConfigHealth}'s to report, and a provider
 * whose listing failed outright is skipped — the picker already surfaces that
 * failure. Kept out of the pure evaluation because it awaits the (briefly
 * cached) provider listings.
 */
export async function evaluateModelListingHealth(
  kiriConfig: KiriConfigLoadResult,
  llmClients: LlmClients,
): Promise<ConfigCheck[]> {
  const refs = modelReferences(kiriConfig.models).filter(({ ref }) => {
    const provider = providerOf(ref);
    return provider !== null && kiriConfig.providers.has(provider);
  });
  if (refs.length === 0) return [];

  const { models, failures } = await llmClients.listModels();
  const failed = new Set(failures.map((failure) => failure.provider));
  const listed = new Set(models.map((model) => model.id));
  const checks: ConfigCheck[] = [];
  for (const { label, ref } of refs) {
    // providerOf is non-null for every ref that survived the filter above.
    const provider = providerOf(ref);
    if (provider === null || failed.has(provider) || listed.has(ref)) continue;
    checks.push({
      area: "models",
      level: "degraded",
      title: `${label}: model not listed`,
      detail: `Provider "${provider}" doesn't currently list "${ref}" — check the model id, or ignore this if the provider's listing is incomplete.`,
    });
  }
  return checks;
}
