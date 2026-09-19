import type { LlmProvider } from "./schema.ts";

/**
 * In-memory LLM provider registry. Holds the providers hydrated from the
 * `providers:` map in `<cwd>/kiri.yaml`. Mutated by the loader via `replace`;
 * read by callers via `getProvider` and `listProviders`.
 */
export interface LlmProviderRegistry {
  /** Monotonic revision, advanced on every replacement, including an empty provider set. */
  revision(): number;
  getProvider(name: string): LlmProvider | undefined;
  listProviders(): LlmProvider[];
  /**
   * Swap the registry's contents wholesale. The map is stored by reference; the
   * caller must treat it as owned by the registry from this point on and not
   * mutate it.
   */
  replace(providers: ReadonlyMap<string, LlmProvider>): void;
}

/** Create an empty LLM provider registry. */
export function createLlmProviderRegistry(): LlmProviderRegistry {
  let providers: ReadonlyMap<string, LlmProvider> = new Map();
  let revision = 0;
  return {
    revision: () => revision,
    getProvider: (name) => providers.get(name),
    listProviders: () => Array.from(providers.values()),
    replace: (next) => {
      providers = next;
      revision += 1;
    },
  };
}
