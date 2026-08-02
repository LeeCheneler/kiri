import { z } from "zod";
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

// A `provider:model` reference, resolved against the `providers:` map at use
// like any session model id.
const modelRef = z.string().min(1);

const modelTiersSchema = z
  .object({
    tanto: modelRef.describe(
      "The smallest, fastest tier: mechanical, fully-specified work. A `provider:model` reference.",
    ),
    katana: modelRef.describe(
      "The mid tier and everyday default for ordinary work. A `provider:model` reference.",
    ),
    odachi: modelRef.describe(
      "The largest tier, for work whose outcome hinges on reasoning depth. A `provider:model` reference.",
    ),
  })
  .strict();

const modelsSchema = z
  .object({
    text: modelTiersSchema
      .optional()
      .describe("The three text (chat) model tiers. Declaring the block defines all three."),
    image: modelTiersSchema
      .optional()
      .describe("The three image-generation model tiers. Declaring the block defines all three."),
  })
  .strict()
  .describe(
    "Named model tiers — tanto, katana, odachi — per modality. Each block is optional, but a present block defines all three tiers. Tier references resolve at use, so re-pointing a tier changes future work without rewriting what past sessions ran on.",
  );

/** One modality's three configured tiers, each a `provider:model` reference. */
export type ModelTiers = z.infer<typeof modelTiersSchema>;

/** The configured model tiers per modality; a modality without tiers is absent. */
export interface ModelTiersConfig {
  text?: ModelTiers;
  image?: ModelTiers;
}

/** The three tier names, smallest first. */
export const MODEL_TIER_NAMES = ["tanto", "katana", "odachi"] as const;

/** A tier name — one of `tanto`, `katana`, `odachi`. */
export type ModelTierName = (typeof MODEL_TIER_NAMES)[number];

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file: the LLM `providers:` map, the `models:` tiers, the `mcp:` servers map,
 * the `filesystem:` sandbox, and the `shell:` working directories. Strict, so
 * an unknown top-level key is a validation error.
 */
export const kiriConfigSchema = z
  .object({
    providers: providersSchema.optional(),
    models: modelsSchema.optional(),
    mcp: mcpServersSchema.optional(),
    filesystem: filesystemSchema.optional(),
    shell: shellSchema.optional(),
  })
  .strict();

/** The raw, validated `kiri.yaml` shape. */
export type KiriConfig = z.infer<typeof kiriConfigSchema>;
