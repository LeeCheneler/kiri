import type { ModelInfo, ModelsFailure } from "../../shared/api/models.ts";
import { type EndpointKind, endpointFor } from "./endpoint.ts";
import { type ListedModel, unlistedModel } from "./models.ts";
import type { LlmProvider, ProviderType } from "./schema.ts";

/**
 * Everything kiri knows about one model on one configured provider, with the
 * three kinds of support kept apart: what the model itself can do, what the
 * provider's transport carries to it, and what the endpoint parses on its
 * behalf. Plain data — safe to cache and to hand between layers.
 */
export interface ModelDescription {
  /** `provider:model` id. */
  id: string;
  /** The configured provider's name. */
  provider: string;
  /** The model's id on that provider. */
  modelId: string;
  /**
   * Whether the provider's listing carries the model. When false the model
   * facts are id-family fallbacks (see `unlistedModel`), not reported ones.
   */
  listed: boolean;
  /** Facts about the model itself. */
  model: Omit<ListedModel, "id" | "provider">;
  /** What the provider's adapter carries to its endpoint. */
  transport: {
    type: ProviderType;
    endpoint: EndpointKind;
    /** The document media types carried as binary file parts. */
    documents: string[];
  };
  /** What the endpoint parses for a model that cannot read it natively. */
  parser: { documents: string[] };
}

/** The models every configured provider offers, described, plus the listings that failed. */
export interface LlmModelsResult {
  models: ModelDescription[];
  /** One entry per provider whose listing failed; the rest still succeed. */
  failures: ModelsFailure[];
}

/**
 * Describe a model on `provider` from what its listing reported, or — given
 * no listing entry — from id-family fallbacks, so an unlisted model still
 * gets a usable description rather than none.
 */
export function describeModel(
  provider: LlmProvider,
  modelId: string,
  listed: ListedModel | undefined,
): ModelDescription {
  const { id, provider: _provider, ...model } = listed ?? unlistedModel(provider, modelId);
  const endpoint = endpointFor(provider);
  return {
    id,
    provider: provider.name,
    modelId,
    listed: listed !== undefined,
    model,
    transport: { type: provider.type, endpoint: endpoint.kind, documents: endpoint.documents },
    parser: { documents: endpoint.parsedDocuments },
  };
}

/**
 * The document media types a session on this model can attach: those the
 * transport carries that the model reads natively — or isn't known not to —
 * or that the endpoint parses for it. None for a model that produces images.
 */
export function acceptedDocuments(description: ModelDescription): string[] {
  if (description.model.output !== "text") return [];
  return description.transport.documents.filter(
    (mediaType) =>
      description.model.nativeDocuments !== false ||
      description.parser.documents.includes(mediaType),
  );
}

/** The browser's public view of a description; execution-only facts stay server-side. */
export function toModelInfo(description: ModelDescription): ModelInfo {
  const { contextWindow, outputLimit, output, imageInput } = description.model;
  const documentInput = acceptedDocuments(description);
  return {
    id: description.id,
    provider: description.provider,
    contextWindow,
    outputLimit,
    output,
    imageInput,
    ...(documentInput.length > 0 ? { documentInput } : {}),
  };
}
