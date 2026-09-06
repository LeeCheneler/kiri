import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { type CodexAuthState, readCodexAuth } from "./codex-auth.ts";

/** Subscription-backed Codex endpoint; never falls back to the billed API. */
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

const AUTH_PROBLEMS = {
  missing:
    "Codex file credentials are missing. Use file credential storage and run `codex login`, then retry.",
  invalid: "Codex file credentials are invalid. Run `codex login`, then retry.",
  unreadable:
    "Codex file credentials could not be read. Check access to CODEX_HOME/auth.json, then retry.",
  expired: "Codex authentication expired. Run `codex login`, then retry.",
};

function requireCredentials(state: CodexAuthState, providerName: string) {
  if (state.status !== "signed-in") {
    throw new Error(`provider "${providerName}": ${AUTH_PROBLEMS[state.status]}`);
  }
  return state;
}

/**
 * Authenticate SDK and listing requests with freshly read Codex credentials.
 * A 401 retries once only when Codex has replaced the credentials on disk.
 * Credentials are never refreshed or written here.
 */
export function createCodexFetch(
  env: Record<string, string | undefined>,
  providerName: string,
): NonNullable<OpenAIProviderSettings["fetch"]> {
  const codexFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://chatgpt.com" || !url.pathname.startsWith("/backend-api/codex/")) {
      throw new Error("Codex credentials can only be sent to the Codex backend");
    }
    request.signal.throwIfAborted();
    const credentials = requireCredentials(await readCodexAuth(env), providerName);
    const send = (auth: typeof credentials) => {
      const copy = request.clone();
      copy.headers.set("authorization", `Bearer ${auth.accessToken}`);
      copy.headers.set("chatgpt-account-id", auth.accountId);
      copy.headers.set("originator", "codex_cli_rs");
      copy.headers.set("OpenAI-Beta", "responses=experimental");
      return fetch(copy, { redirect: "error" });
    };
    const response = await send(credentials);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    const updated = requireCredentials(await readCodexAuth(env), providerName);
    if (
      updated.accessToken !== credentials.accessToken ||
      updated.accountId !== credentials.accountId
    ) {
      const retry = await send(updated);
      if (retry.status !== 401) return retry;
      await retry.body?.cancel();
    }
    throw new Error(
      `provider "${providerName}": Codex authentication was rejected. Run \`codex login\`, then retry.`,
    );
  };
  return Object.assign(codexFetch, { preconnect: fetch.preconnect });
}
