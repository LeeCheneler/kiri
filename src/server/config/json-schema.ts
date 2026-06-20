import { z } from "zod";
import { kiriConfigSchema } from "./schema.ts";

/**
 * Generate the JSON Schema (Draft 2020-12) representation of the `kiri.yaml`
 * shape. Used to produce `.kiri/kiri.schema.json` for IDE/LSP integration so
 * editors can validate and autocomplete the file.
 */
export function kiriConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(kiriConfigSchema) as Record<string, unknown>;
}
