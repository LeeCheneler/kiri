import { TAVILY_API_KEY_ENV } from "../sessions/tools/index.ts";
import type { KiriConfigLoadResult } from "./loader.ts";

/** Severity of a config check: wired correctly, working-but-reduced, or broken. */
export type ConfigCheckLevel = "ok" | "degraded" | "error";

/** The configuration concern a check reports on. */
export type ConfigArea = "config" | "providers" | "mcp" | "web-search";

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

/**
 * Classify a workspace's configuration into ok / degraded / error checks from
 * an already-loaded {@link KiriConfigLoadResult} and the process environment.
 * Pure: no disk, no console — the single source of truth both the CLI boot
 * report and `GET /api/config/health` render. "Required" is contextual: no
 * providers is *degraded* (sh/use workflows still run), a declared provider with
 * a missing API key is an *error*, and a missing Tavily key is *degraded* (web
 * search simply off). Never inspects a resolved key value, only its presence.
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

  // Web search (Tavily): degraded, never an error — the tools self-gate on this
  // exact key, so an absent one just means sessions run without them.
  const tavily = env[TAVILY_API_KEY_ENV]?.trim();
  checks.push(
    tavily
      ? {
          area: "web-search",
          level: "ok",
          title: "Web search enabled",
          detail: `${TAVILY_API_KEY_ENV} is set, so sessions can use web_search and web_extract.`,
        }
      : {
          area: "web-search",
          level: "degraded",
          title: "Web search disabled",
          detail: `${TAVILY_API_KEY_ENV} is not set, so sessions run without web_search and web_extract.`,
        },
  );

  return { checks };
}
