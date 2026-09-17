import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { ALL_DOCUMENT_MEDIA_TYPES } from "../../shared/document-types.ts";

// OpenRouter parses a document for any model: natively where the model takes
// file input, otherwise through a parser plugin whose default engine is a
// paid OCR pass. This free engine extracts the text instead, so a document
// sent to a model without native support never bills per page unasked.
const FREE_PDF_ENGINE = "cloudflare-ai";

const hasDocumentPart = (prompt: LanguageModelV3CallOptions["prompt"]): boolean =>
  prompt.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "file" && ALL_DOCUMENT_MEDIA_TYPES.includes(part.mediaType),
      ),
  );

/**
 * The call options for an OpenRouter request, with the free document parser
 * requested under the provider's options when the prompt carries a document
 * and the model is not known to read one natively. Otherwise the options pass
 * through untouched, leaving OpenRouter to its default (native) handling.
 */
export function withDocumentParser(
  params: LanguageModelV3CallOptions,
  providerName: string,
  nativeDocuments: boolean | undefined,
): LanguageModelV3CallOptions {
  if (nativeDocuments === true || !hasDocumentPart(params.prompt)) return params;
  return {
    ...params,
    providerOptions: {
      ...params.providerOptions,
      [providerName]: {
        ...params.providerOptions?.[providerName],
        plugins: [{ id: "file-parser", pdf: { engine: FREE_PDF_ENGINE } }],
      },
    },
  };
}

/**
 * Wrap an OpenRouter-backed model so each request picks its document parser
 * (see `withDocumentParser`). `nativeDocuments` is read per request from the
 * provider's listing, so a model that gains native support is picked up on
 * the next listing refresh.
 */
export function createOpenRouterModel(
  model: LanguageModelV3,
  providerName: string,
  nativeDocuments: () => Promise<boolean | undefined>,
): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) =>
        withDocumentParser(params, providerName, await nativeDocuments()),
    },
  });
}
