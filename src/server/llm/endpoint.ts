import { ALL_DOCUMENT_MEDIA_TYPES, PDF_MEDIA_TYPE } from "../../shared/document-types.ts";
import type { LlmProvider } from "./schema.ts";

/**
 * Which backend a provider's requests reach. The first-party types name
 * themselves; an `openai-compatible` provider is `openrouter` when its base
 * URL points there, and `custom` — any other OpenAI-style server, local or
 * hosted — otherwise.
 */
export type EndpointKind = "anthropic" | "openai" | "openai-codex" | "openrouter" | "custom";

/** A provider's endpoint: the backend it reaches and what its transport carries. */
export interface LlmEndpoint {
  kind: EndpointKind;
  /**
   * The document media types the transport carries as binary file parts.
   * Whether a document reaches the model is decided by the transport, not the
   * model: the Codex backend speaks OpenAI's Responses API, which takes PDFs
   * and Office documents (text-extracted); OpenAI's chat API and Anthropic
   * take PDFs alone; OpenRouter maps a PDF file part for every model it
   * routes to; and a custom endpoint takes none — local servers reject one.
   */
  documents: string[];
}

const OPENROUTER_HOST = "openrouter.ai";

// A malformed or absent base URL is not OpenRouter.
const isOpenRouterUrl = (baseUrl: string | undefined): boolean => {
  try {
    return baseUrl !== undefined && new URL(baseUrl).hostname === OPENROUTER_HOST;
  } catch {
    return false;
  }
};

/** Describe the endpoint a configured provider reaches. */
export function endpointFor(provider: LlmProvider): LlmEndpoint {
  switch (provider.type) {
    case "openai-codex":
      return { kind: "openai-codex", documents: [...ALL_DOCUMENT_MEDIA_TYPES] };
    case "openai":
      return { kind: "openai", documents: [PDF_MEDIA_TYPE] };
    case "anthropic":
      return { kind: "anthropic", documents: [PDF_MEDIA_TYPE] };
    case "openai-compatible":
      return isOpenRouterUrl(provider.baseUrl)
        ? { kind: "openrouter", documents: [PDF_MEDIA_TYPE] }
        : { kind: "custom", documents: [] };
  }
}
