// Suggested replies live under one localStorage key, as a map keyed by the
// assistant message they answer, so each settled turn is generated for once
// per browser — an empty answer is a first-class cached fact, not a miss.
// One TTL serves as both the fetch-eligibility window and the eviction age:
// by the time an entry expires, its message is too old to fetch for, so
// expiry is storage hygiene and never causes a refetch.

const STORAGE_KEY = "kiri:suggested-replies";

/** How long a settled turn stays eligible for suggested replies — and how long a cached answer is kept. */
export const SUGGESTED_REPLIES_TTL_MS = 24 * 60 * 60 * 1000;

type SuggestedRepliesCache = Record<string, { replies: string[]; at: number }>;

const readCache = (): SuggestedRepliesCache => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as SuggestedRepliesCache) : {};
  } catch {
    return {};
  }
};

/**
 * The cached suggested replies for an assistant message — an empty list is a
 * real cached answer — or undefined when it was never asked about (or the
 * entry has aged out).
 */
export function readSuggestedReplies(messageId: string): string[] | undefined {
  const entry = readCache()[messageId];
  if (entry === undefined || Date.now() - entry.at > SUGGESTED_REPLIES_TTL_MS) return undefined;
  return entry.replies;
}

/** Cache a message's suggested replies — empty included — pruning aged-out entries as it writes. */
export function writeSuggestedReplies(messageId: string, replies: string[]): void {
  const now = Date.now();
  const pruned = Object.fromEntries(
    Object.entries(readCache()).filter(([, entry]) => now - entry.at <= SUGGESTED_REPLIES_TTL_MS),
  );
  pruned[messageId] = { replies, at: now };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
}
