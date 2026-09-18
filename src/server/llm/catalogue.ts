import { type ProviderListing, listProviderModels } from "./models.ts";
import type { LlmProvider } from "./schema.ts";

// Reuse a provider's listing for a few minutes. A failed discovery is kept
// only briefly: long enough that a dead endpoint doesn't cost every turn a
// full discovery timeout, short enough that a recovered one is noticed soon.
const LISTING_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;

/**
 * Model listings cached per provider, so a reader waits on discovery for its
 * own provider alone. One catalogue serves one provider configuration; a
 * configuration change starts a fresh one.
 */
export interface ModelCatalogue {
  /**
   * The provider's listing, from cache while fresh, discovering it otherwise.
   * Concurrent readers share one discovery request. `signal` abandons this
   * caller's wait — it settles at once with an empty listing whose `reason`
   * says so — and leaves the shared request running for the others. Never
   * rejects: every failure is a `reason`.
   */
  listing(provider: LlmProvider, options?: { signal?: AbortSignal }): Promise<ProviderListing>;
  /**
   * Discover the provider's models afresh and cache the result, so readers
   * see what the caller was just shown. A failed refresh is reported but
   * doesn't displace a successful listing that is still fresh.
   */
  refresh(provider: LlmProvider): Promise<ProviderListing>;
}

interface CatalogueEntry {
  at: number;
  /** Whether discovery settled as a failure; false while in flight. */
  failed: boolean;
  promise: Promise<ProviderListing>;
}

/** Create an empty catalogue that discovers listings with keys read from `env`. */
export function createModelCatalogue(
  env: Record<string, string | undefined>,
  options: { timeoutMs?: number } = {},
): ModelCatalogue {
  const entries = new Map<string, CatalogueEntry>();

  const isFresh = (entry: CatalogueEntry): boolean =>
    Date.now() - entry.at < (entry.failed ? FAILURE_TTL_MS : LISTING_TTL_MS);

  const discover = (provider: LlmProvider): CatalogueEntry => {
    const entry: CatalogueEntry = {
      at: Date.now(),
      failed: false,
      promise: listProviderModels(provider, env, options).then((listing) => {
        entry.failed = listing.reason !== undefined;
        return listing;
      }),
    };
    return entry;
  };

  return {
    listing(provider, { signal } = {}) {
      let entry = entries.get(provider.name);
      if (entry === undefined || !isFresh(entry)) {
        entry = discover(provider);
        entries.set(provider.name, entry);
      }
      return signal === undefined ? entry.promise : abandonable(entry.promise, signal);
    },
    async refresh(provider) {
      const next = discover(provider);
      const listing = await next.promise;
      const current = entries.get(provider.name);
      // Keep a fresh successful listing over a failed refresh, or over a
      // refresh that started earlier and merely settled later.
      const keepCurrent =
        current !== undefined &&
        !current.failed &&
        isFresh(current) &&
        (next.failed || current.at > next.at);
      if (!keepCurrent) entries.set(provider.name, next);
      return listing;
    },
  };
}

// Settle with `promise`, or with an empty listing once `signal` fires.
// `promise` itself never rejects — discovery reports failure as a value.
function abandonable(
  promise: Promise<ProviderListing>,
  signal: AbortSignal,
): Promise<ProviderListing> {
  return new Promise((resolve) => {
    const onAbort = () => resolve({ models: [], reason: "discovery wait cancelled" });
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((listing) => {
      signal.removeEventListener("abort", onAbort);
      resolve(listing);
    });
  });
}
