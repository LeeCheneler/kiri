import { z } from "zod";
import { providersSchema } from "../llm/schema.ts";

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file. Currently just the LLM `providers:` map; tools and settings will join
 * it as siblings. Strict, so an unknown top-level key is a validation error.
 */
export const kiriConfigSchema = z
  .object({
    providers: providersSchema.optional(),
  })
  .strict();

/** The raw, validated `kiri.yaml` shape. */
export type KiriConfig = z.infer<typeof kiriConfigSchema>;
