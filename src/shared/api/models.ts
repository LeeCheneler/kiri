/** A model offered by a configured provider, as returned by `GET /api/models`. */
export interface ModelInfo {
  /** `provider:model` id — ready to start a session against. */
  id: string;
  /** The provider the model came from. */
  provider: string;
  /** Maximum context (input) tokens, when the provider's listing reports it. */
  contextWindow?: number;
  /** Maximum output tokens, when the provider's listing reports it. */
  outputLimit?: number;
  /** What the model produces. Models producing neither text nor images are never listed. */
  output: "text" | "image";
  /** Whether the model accepts image input; absent when the provider's listing doesn't say. */
  imageInput?: boolean;
  /** The document media types (PDF, Office) the model's provider carries; absent when none. */
  documentInput?: string[];
}

/** A provider whose model listing failed, surfaced so the picker can explain a gap. */
export interface ModelsFailure {
  provider: string;
  reason: string;
}

/** One modality's named model shortcuts, `name → provider:model`, in config order. */
export type ModelShortcuts = Record<string, string>;

/** The configured shortcuts per modality; a modality without shortcuts is absent. */
export interface ModelShortcutsConfig {
  text?: ModelShortcuts;
  image?: ModelShortcuts;
}

/** Available models across configured providers, plus any per-provider failures and the configured shortcuts. */
export interface ModelsResult {
  models: ModelInfo[];
  failures: ModelsFailure[];
  shortcuts?: ModelShortcutsConfig;
  /** The configured utility model, `provider:model`; absent when none is set. */
  utility?: string;
  /** The configured transcription model, `provider:model`; absent when none is set. */
  transcription?: string;
}
