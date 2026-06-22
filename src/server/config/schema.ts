import { z } from "zod";
import { providersSchema } from "../llm/schema.ts";
import { mcpServersSchema } from "../mcp/schema.ts";

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file: the LLM `providers:` map and the `mcp:` servers map. Strict, so an
 * unknown top-level key is a validation error.
 */
export const kiriConfigSchema = z
  .object({
    providers: providersSchema.optional(),
    mcp: mcpServersSchema.optional(),
  })
  .strict();

/** The raw, validated `kiri.yaml` shape. */
export type KiriConfig = z.infer<typeof kiriConfigSchema>;
