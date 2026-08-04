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

const shortcutsRecord = z.record(
  z.string().min(1).describe("The shortcut's display name — free-form, shown in the pickers."),
  modelRef.describe("A `provider:model` reference."),
);

const modelShortcutsSchema = z
  .object({
    text: shortcutsRecord
      .optional()
      .describe(
        "Named text (chat) model shortcuts. The first entry is the default model for new sessions.",
      ),
    image: shortcutsRecord
      .optional()
      .describe(
        "Named image-generation model shortcuts. The first entry is the default image model for new sessions.",
      ),
  })
  .strict()
  .describe(
    "Named model shortcuts per modality — free-form names mapping to `provider:model` references, pinned to the top of the session pickers in config order. Picking one selects its model; nothing is stored by name, so re-pointing a shortcut changes future picks without rewriting what past sessions ran on.",
  );

const modelDelegatesSchema = z
  .object({
    quick: modelRef
      .optional()
      .describe(
        "The worker model for mechanical, fully-specified tasks. A `provider:model` reference.",
      ),
    daily: modelRef
      .optional()
      .describe("The worker model for ordinary work — the default. A `provider:model` reference."),
    deep: modelRef
      .optional()
      .describe(
        "The worker model for tasks whose outcome hinges on reasoning depth. A `provider:model` reference.",
      ),
  })
  .strict()
  .describe(
    "The models delegated worker sessions run, by role — quick, daily, deep. Any subset may be configured; the assistant sizes each delegated task to a configured role. With none configured, workers inherit the delegating session's model.",
  );

const modelsSchema = z
  .object({
    shortcuts: modelShortcutsSchema.optional(),
    delegates: modelDelegatesSchema.optional(),
    utility: modelRef
      .optional()
      .describe(
        "The model kiri itself uses for small internal one-off generations, such as naming a new session or judging shell commands under the Auto permission. A `provider:model` reference — point it at a fast, cheap model (a local one works well). Unset, session titling falls back to the session's model; the Auto shell permission falls back to asking.",
      ),
  })
  .strict()
  .describe(
    "Model configuration: `shortcuts` pin your named favourites to the top of the session pickers, `delegates` size the workers the assistant delegates to, `utility` runs kiri's own small internal generations. All references resolve at use.",
  );

/** One modality's named shortcuts, `name → provider:model`, in config order. */
export type ModelShortcuts = Record<string, string>;

/** The configured shortcuts per modality; a modality without shortcuts is absent. */
export interface ModelShortcutsConfig {
  text?: ModelShortcuts;
  image?: ModelShortcuts;
}

/** The delegate role names, lightest task shape first. */
export const DELEGATE_ROLES = ["quick", "daily", "deep"] as const;

/** A delegate role — one of `quick`, `daily`, `deep`. */
export type DelegateRole = (typeof DELEGATE_ROLES)[number];

/** The configured delegate models by role; an unconfigured role is absent. */
export type ModelDelegates = Partial<Record<DelegateRole, string>>;

/** The resolved `models:` section — maps always present, empty when unconfigured. */
export interface ModelsConfig {
  shortcuts: ModelShortcutsConfig;
  delegates: ModelDelegates;
  /** The model for kiri's internal one-off generations; absent when unconfigured. */
  utility?: string;
}

/** The delegate roles that have a model configured, lightest first. */
export function configuredDelegateRoles(delegates: ModelDelegates | undefined): DelegateRole[] {
  return DELEGATE_ROLES.filter((role) => delegates?.[role] !== undefined);
}

/**
 * Zod schema for the workspace's `kiri.yaml` — kiri's structured configuration
 * file: the LLM `providers:` map, the `models:` shortcuts and delegates, the
 * `mcp:` servers map, the `filesystem:` sandbox, and the `shell:` working
 * directories. Strict, so an unknown top-level key is a validation error.
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
