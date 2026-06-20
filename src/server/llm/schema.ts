import { z } from "zod";

const envRefSchema = z
  .object({
    env: z.string().min(1).describe("Name of an environment variable holding the API key."),
  })
  .strict()
  .describe(
    "Reference to an environment variable holding the API key. Only this `{ env: <NAME> }` form is allowed — a literal key string is rejected so secrets stay out of git-tracked YAML.",
  );

const baseUrlSchema = z.string().min(1);

const anthropicProviderSchema = z
  .object({
    type: z.literal("anthropic"),
    base_url: baseUrlSchema.optional().describe("Override the Anthropic API base URL."),
    api_key: envRefSchema.optional(),
  })
  .strict();

const openaiProviderSchema = z
  .object({
    type: z.literal("openai"),
    base_url: baseUrlSchema.optional().describe("Override the OpenAI API base URL."),
    api_key: envRefSchema.optional(),
  })
  .strict();

const openaiCompatibleProviderSchema = z
  .object({
    type: z.literal("openai-compatible"),
    base_url: baseUrlSchema.describe("Base URL of the OpenAI-compatible endpoint. Required."),
    api_key: envRefSchema.optional(),
  })
  .strict();

/**
 * A single provider entry, discriminated on `type`. `type` is always required —
 * there is no inference from the entry's key — so the published JSON Schema can
 * surface every rule (notably that `openai-compatible` requires `base_url`) as
 * an editor error rather than deferring it to load time.
 */
const providerEntrySchema = z.discriminatedUnion("type", [
  anthropicProviderSchema,
  openaiProviderSchema,
  openaiCompatibleProviderSchema,
]);

/** Schema for the `providers:` map in `kiri.yaml`, keyed by provider name. */
export const providersSchema = z
  .record(z.string().min(1), providerEntrySchema)
  .describe("LLM endpoints `llm:` steps can reference, keyed by name.");

/** A single validated provider entry. */
export type ProviderEntry = z.infer<typeof providerEntrySchema>;

/** A built-in provider type. */
export type ProviderType = ProviderEntry["type"];

/** A structured `{ env: <NAME> }` reference to an environment variable. */
export type EnvRef = z.infer<typeof envRefSchema>;

/**
 * A provider after the loader resolves it: its `type`, the optional base URL,
 * and the *name* of the environment variable its API key is read from (never
 * the key's value). `apiKeyEnv` is undefined only for an `openai-compatible`
 * provider with no declared `api_key`.
 */
export interface LlmProvider {
  /** Provider name — the `providers:` map key. */
  name: string;
  /** Provider type. */
  type: ProviderType;
  /** Base URL override; always present for `openai-compatible`. */
  baseUrl?: string;
  /** Env var name the API key is read from at use time, if any. */
  apiKeyEnv?: string;
}
