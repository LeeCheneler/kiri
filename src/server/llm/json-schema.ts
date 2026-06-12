import { z } from "zod";
import { llmProvidersSchema } from "./schema.ts";

/**
 * Generate the JSON Schema (Draft 2020-12) representation of the
 * `llm-providers.yaml` shape. Used to produce `.kiri/llm-providers.schema.json`
 * for IDE/LSP integration so editors can validate and autocomplete the file.
 */
export function llmProvidersJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(llmProvidersSchema) as Record<string, unknown>;
}
