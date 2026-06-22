import { existsSync, readFileSync } from "node:fs";
import type { LlmProvider, ProviderType } from "../llm/schema.ts";
import type { McpServer, McpServerEntry, McpServerUnresolved } from "../mcp/schema.ts";
import { kiriConfigSchema } from "./schema.ts";
import type { ConfigStore } from "./store.ts";

/**
 * Conventional environment variable an `api_key`-less provider falls back to,
 * by type. `openai-compatible` has no convention and needs no key.
 */
const CONVENTIONAL_API_KEY_ENV: Partial<Record<ProviderType, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** A failure loading `kiri.yaml` — read, parse, validation, or env-ref. */
export interface KiriConfigLoadFailure {
  /** Absolute path of the config file. */
  path: string;
  /** Human-readable reason. Never echoes a resolved secret value. */
  reason: string;
}

export interface KiriConfigLoadResult {
  /** Providers keyed by `name`. Empty when the file is absent or failed to load. */
  providers: Map<string, LlmProvider>;
  /** MCP servers keyed by `name` whose declared env refs all resolve. Empty when the file is absent or failed to load. */
  mcp: Map<string, McpServer>;
  /** MCP servers excluded because a declared env ref names an unset variable. */
  mcpUnresolved: McpServerUnresolved[];
  /** Set when a present file failed to load. An absent file is not a failure. */
  failure?: KiriConfigLoadFailure;
  /** Non-fatal note — e.g. both `kiri.yaml` and `kiri.yml` exist and the canonical one was used. */
  warning?: string;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** An empty result (no providers, no MCP servers), optionally carrying a failure. */
const emptyResult = (extra: Partial<KiriConfigLoadResult> = {}): KiriConfigLoadResult => ({
  providers: new Map(),
  mcp: new Map(),
  mcpUnresolved: [],
  ...extra,
});

/**
 * Load the workspace's `kiri.yaml` (or `kiri.yml`) and resolve its `providers:`
 * and `mcp:` maps. An absent file is first-class: an empty registry, not a
 * failure. A present file that fails to read, parse, or validate — or whose
 * declared provider `{ env: }` refs name a variable missing from `env` — yields
 * an empty result plus a `failure` describing why, the same posture as a
 * workflow that can't load. An MCP server whose declared env ref is unset is
 * handled per-server instead: it's excluded into `mcpUnresolved` (surfaced as a
 * health error) without failing the load, so a missing MCP token never takes
 * down providers or other servers. Only declared refs are presence-checked;
 * conventional provider fallbacks resolve at use time. Resolved secret *values*
 * are never read or stored — only the env var's name is kept. If both
 * `kiri.yaml` and `kiri.yml` exist, the canonical `.yaml` wins and a `warning`
 * flags the duplicate.
 */
export function loadKiriConfig(
  config: ConfigStore,
  env: Record<string, string | undefined>,
): KiriConfigLoadResult {
  const candidates = config.configFiles();
  const present = candidates.filter((path) => existsSync(path));
  if (present.length === 0) return emptyResult();

  const result = loadConfigFile(present[0], env);
  if (present.length > 1) {
    result.warning = `both ${candidates[0]} and ${candidates[1]} exist — using ${candidates[0]}`;
  }
  return result;
}

/** Read, parse, validate, and resolve a single config file known to exist. */
function loadConfigFile(
  path: string,
  env: Record<string, string | undefined>,
): KiriConfigLoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return emptyResult({ failure: { path, reason: reasonOf(cause) } });
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (cause) {
    return emptyResult({ failure: { path, reason: reasonOf(cause) } });
  }

  // An empty or comment-only file parses to null — treat it as "no config", the
  // same as an absent file, so a commented starter kiri.yaml loads cleanly.
  if (parsed === null || parsed === undefined) return emptyResult();

  const result = kiriConfigSchema.safeParse(parsed);
  if (!result.success) {
    return emptyResult({ failure: { path, reason: result.error.message } });
  }

  const providers = new Map<string, LlmProvider>();
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
    return emptyResult({
      failure: {
        path,
        reason: `unresolved api_key env ${noun}: ${missing.join(", ")} (not set in the kiri process environment)`,
      },
    });
  }

  const { mcp, mcpUnresolved } = resolveMcpServers(result.data.mcp ?? {}, env);
  return { providers, mcp, mcpUnresolved };
}

/** Resolve declared MCP servers, excluding any whose declared env refs are unset. */
function resolveMcpServers(
  declared: Record<string, McpServerEntry>,
  env: Record<string, string | undefined>,
): { mcp: Map<string, McpServer>; mcpUnresolved: McpServerUnresolved[] } {
  const mcp = new Map<string, McpServer>();
  const mcpUnresolved: McpServerUnresolved[] = [];

  for (const [name, entry] of Object.entries(declared)) {
    const source = entry.type === "stdio" ? entry.env : entry.headers;
    const { refs, missing } = resolveEnvRefs(source, env);
    if (missing.length > 0) {
      mcpUnresolved.push({ name, missing });
      continue;
    }
    if (entry.type === "stdio") {
      mcp.set(name, {
        name,
        type: "stdio",
        command: entry.command,
        args: entry.args,
        envRefs: refs,
      });
    } else {
      const server: McpServer = { name, type: "http", url: entry.url, headerRefs: refs };
      // OAuth servers carry no static-auth env ref; the token is obtained via the
      // sign-in flow and managed in the credential store.
      if (entry.auth === "oauth") server.oauth = true;
      mcp.set(name, server);
    }
  }

  return { mcp, mcpUnresolved };
}

/** Flatten an `{ key: { env: NAME } }` map to `{ key: NAME }`, collecting unset NAMEs. */
function resolveEnvRefs(
  source: Record<string, { env: string }> | undefined,
  env: Record<string, string | undefined>,
): { refs: Record<string, string> | undefined; missing: string[] } {
  if (!source) return { refs: undefined, missing: [] };
  const refs: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, ref] of Object.entries(source)) {
    if (env[ref.env] === undefined) missing.push(ref.env);
    refs[key] = ref.env;
  }
  return { refs, missing };
}
