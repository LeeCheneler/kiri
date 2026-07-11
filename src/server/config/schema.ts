import { z } from "zod";
import { providersSchema } from "../llm/schema.ts";
import { mcpServersSchema } from "../mcp/schema.ts";

const filesystemSchema = z
  .object({
    allowed_directories: z
      .array(z.string().min(1))
      .describe(
        'Directories the session filesystem tools may touch, each relative to the workspace root (absolute paths allowed; "." grants the workspace root itself). An empty list is the same as omitting the section.',
      ),
  })
  .strict()
  .describe(
    "Directory sandbox for the first-party filesystem tools offered to agentic sessions. Declaring it is what enables the tools; absent, they are not offered at all.",
  );

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file: the LLM `providers:` map, the `mcp:` servers map, and the `filesystem:`
 * sandbox. Strict, so an unknown top-level key is a validation error.
 */
export const kiriConfigSchema = z
  .object({
    providers: providersSchema.optional(),
    mcp: mcpServersSchema.optional(),
    filesystem: filesystemSchema.optional(),
  })
  .strict();

/** The raw, validated `kiri.yaml` shape. */
export type KiriConfig = z.infer<typeof kiriConfigSchema>;
