import { z } from "zod";
import { worktreesSchema } from "../git/schema.ts";
import { providersSchema } from "../llm/schema.ts";
import { mcpServersSchema } from "../mcp/schema.ts";

const filesystemSchema = z
  .object({
    allowed_directories: z
      .array(z.string().min(1))
      .describe(
        'Directories the session filesystem tools may touch, each relative to the workspace root ("." grants the workspace root itself). Absolute paths are allowed, and a leading ~ expands to your home directory. An empty list is the same as omitting the section.',
      ),
  })
  .strict()
  .describe(
    "Directory sandbox for the first-party filesystem tools offered to agentic sessions. Declaring it is what enables the tools; absent, they are not offered at all.",
  );

const shellSchema = z
  .object({
    working_directories: z
      .array(z.string().min(1))
      .describe(
        'Directories the session shell tool may run commands in, each relative to the workspace root ("." grants the workspace root itself). Absolute paths are allowed, and a leading ~ expands to your home directory. An empty list is the same as omitting the section.',
      ),
  })
  .strict()
  .describe(
    "Working directories for the first-party shell tool offered to agentic sessions. Declaring it is what enables the tool; absent, it is not offered at all. Only a command's working directory is confined to these — what the command touches is not, so every call asks for approval by default.",
  );

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file: the LLM `providers:` map, the `mcp:` servers map, the `filesystem:`
 * sandbox, the `shell:` working directories, and the `worktrees:` management
 * section. Strict, so an unknown top-level key is a validation error.
 */
export const kiriConfigSchema = z
  .object({
    providers: providersSchema.optional(),
    mcp: mcpServersSchema.optional(),
    filesystem: filesystemSchema.optional(),
    shell: shellSchema.optional(),
    worktrees: worktreesSchema.optional(),
  })
  .strict();

/** The raw, validated `kiri.yaml` shape. */
export type KiriConfig = z.infer<typeof kiriConfigSchema>;
