import type { DataUIPart, UIDataTypes } from "ai";
import { useSyncExternalStore } from "react";

/** The live merged output of one running tool call, as the server snapshots it. */
export interface LiveConsole {
  /** The output's tail so far. */
  text: string;
  /** Whether output ahead of the tail was dropped by the server's cap. */
  truncated: boolean;
}

/**
 * Turn-scoped store of live tool consoles, keyed by tool call. Transient
 * `data-tool-console` parts never join the transcript, so they land here —
 * outside `useChat`'s messages — and only the block rendering a call's console
 * re-renders per snapshot, leaving every settled message's memo intact.
 * Callers keep the store referentially stable for the same reason.
 */
export interface LiveConsoleStore {
  /** Record a call's latest snapshot, replacing the previous one. */
  set(toolCallId: string, snapshot: LiveConsole): void;
  /** A call's latest snapshot, or undefined before its first one. */
  get(toolCallId: string): LiveConsole | undefined;
  /** Drop every snapshot — a settled turn's consoles are dead weight. */
  clear(): void;
  /** Listen for any change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Build a fresh live-console store; the conversation engine owns one per session. */
export function createLiveConsoleStore(): LiveConsoleStore {
  const snapshots = new Map<string, LiveConsole>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    set(toolCallId, snapshot) {
      snapshots.set(toolCallId, snapshot);
      notify();
    },
    get(toolCallId) {
      return snapshots.get(toolCallId);
    },
    clear() {
      if (snapshots.size === 0) return;
      snapshots.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A streamed data part as a live-console update: the tool call it belongs to
 * (the part id) and its snapshot. Null for other data parts and malformed
 * payloads — the stream is data, not something to trust blindly.
 */
export const liveConsoleOf = (
  dataPart: DataUIPart<UIDataTypes>,
): { toolCallId: string; snapshot: LiveConsole } | null => {
  if (dataPart.type !== "data-tool-console" || typeof dataPart.id !== "string") return null;
  const { text, truncated } = (dataPart.data ?? {}) as { text?: unknown; truncated?: unknown };
  if (typeof text !== "string") return null;
  return { toolCallId: dataPart.id, snapshot: { text, truncated: truncated === true } };
};

const noopSubscribe = () => () => {};

/**
 * Follow one call's live console: re-renders the caller on each snapshot and
 * nothing else. Undefined before the first snapshot — and always, in a context
 * with no store wired.
 */
export function useLiveConsole(
  store: LiveConsoleStore | undefined,
  toolCallId: string,
): LiveConsole | undefined {
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, () => store?.get(toolCallId));
}
