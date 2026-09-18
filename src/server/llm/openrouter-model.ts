import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { ModelDescription } from "./model-description.ts";

// OpenRouter parses a document for any model: natively where the model takes
// file input, otherwise through a parser plugin whose default engine is a
// paid OCR pass. This free engine extracts the text instead, so a document
// sent to a model without native support never bills per page unasked.
const FREE_PDF_ENGINE = "cloudflare-ai";

const hasDocumentPart = (
  prompt: LanguageModelV3CallOptions["prompt"],
  mediaTypes: string[],
): boolean =>
  prompt.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "file" && mediaTypes.includes(part.mediaType)),
  );

/**
 * The call options for an OpenRouter request, with the free document parser
 * requested under the provider's options when the prompt carries a document
 * the endpoint parses and the model is not known to read it natively.
 * Otherwise the options pass through untouched, leaving OpenRouter to its
 * default (native) handling.
 */
export function withDocumentParser(
  params: LanguageModelV3CallOptions,
  description: ModelDescription,
): LanguageModelV3CallOptions {
  if (
    description.model.nativeDocuments === true ||
    !hasDocumentPart(params.prompt, description.parser.documents)
  ) {
    return params;
  }
  return {
    ...params,
    providerOptions: {
      ...params.providerOptions,
      [description.provider]: {
        ...params.providerOptions?.[description.provider],
        plugins: [{ id: "file-parser", pdf: { engine: FREE_PDF_ENGINE } }],
      },
    },
  };
}

/**
 * Wrap an OpenRouter-backed model so each request picks its document parser
 * (see `withDocumentParser`). The model is described per request, so one that
 * gains native support is picked up on the next listing refresh.
 */
export function createOpenRouterModel(
  model: LanguageModelV3,
  describe: () => Promise<ModelDescription>,
): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => withDocumentParser(params, await describe()),
    },
  });
}
