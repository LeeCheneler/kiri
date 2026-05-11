import { z } from "zod";

const envSchema = z
  .record(z.string(), z.string())
  .refine((env) => Object.keys(env).every((key) => !key.startsWith("KIRI_")), {
    message: "env keys starting with 'KIRI_' are reserved",
  });

const useStepSchema = z
  .object({
    use: z.string().min(1),
    env: envSchema.optional(),
  })
  .strict();

const shStepSchema = z
  .object({
    sh: z.string().min(1),
    env: envSchema.optional(),
  })
  .strict();

const stepSchema = z.union([useStepSchema, shStepSchema]);

const publishNameSchema = z.string().regex(/^[a-z0-9-]+$/, {
  message: "publish name must match ^[a-z0-9-]+$",
});

const usePublishSchema = z
  .object({
    name: publishNameSchema,
    title: z.string().min(1).optional(),
    use: z.string().min(1),
    env: envSchema.optional(),
  })
  .strict();

const shPublishSchema = z
  .object({
    name: publishNameSchema,
    title: z.string().min(1).optional(),
    sh: z.string().min(1),
    env: envSchema.optional(),
  })
  .strict();

const publishEntrySchema = z.union([usePublishSchema, shPublishSchema]);

const publishArraySchema = z
  .array(publishEntrySchema)
  .refine((entries) => new Set(entries.map((e) => e.name)).size === entries.length, {
    message: "publish names must be unique within a workflow",
  });

/** Zod schema for a YAML workflow definition. */
export const workflowSchema = z
  .object({
    name: z.string().min(1),
    steps: z.array(stepSchema).min(1),
    gating: z.enum(["auto", "propose"]).optional(),
    schedule: z.string().min(1).optional(),
    /**
     * Optional post-run step whose stdout becomes the run's feed-entry
     * summary. Same shape, validation rules, and reserved-namespace
     * guarantees as a regular step. Runs after `steps:` terminates;
     * failure is non-fatal to the run.
     */
    summarize: stepSchema.optional(),
    /**
     * Optional list of artefacts the workflow publishes after `steps:`
     * terminates with `ok` or `failed`. Each entry runs through the same
     * executor path as a step; its trimmed stdout is stored as a markdown
     * artefact keyed by `name`. Names must be unique within a workflow.
     */
    publish: publishArraySchema.optional(),
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type UseStep = z.infer<typeof useStepSchema>;
export type ShStep = z.infer<typeof shStepSchema>;
export type PublishEntry = z.infer<typeof publishEntrySchema>;
export type UsePublish = z.infer<typeof usePublishSchema>;
export type ShPublish = z.infer<typeof shPublishSchema>;
export type Gating = "auto" | "propose";

/** Type guard: a step is a `use:` bundle reference. */
export const isUseStep = (step: WorkflowStep): step is UseStep => "use" in step;

/** Type guard: a step is an inline `sh:` shell snippet. */
export const isShStep = (step: WorkflowStep): step is ShStep => "sh" in step;

/** Type guard: a publish entry is a `use:` bundle reference. */
export const isUsePublish = (entry: PublishEntry): entry is UsePublish => "use" in entry;

/** Type guard: a publish entry is an inline `sh:` shell snippet. */
export const isShPublish = (entry: PublishEntry): entry is ShPublish => "sh" in entry;

/**
 * Resolve a publish entry's display title. Returns the explicit `title`
 * when set; otherwise titlecases the hyphen-separated `name`
 * (`pr-digest` → `PR Digest`). Tokens of two or fewer characters are
 * uppercased (`pr` → `PR`); longer tokens get only their first letter
 * capitalised. The single titlecasing site — callers that need a
 * resolved title (DB write, UI fallback) go through here.
 */
export const resolvePublishTitle = (name: string, title?: string): string => {
  if (title !== undefined && title.length > 0) return title;
  return name
    .split("-")
    .map((token) =>
      token.length === 0
        ? token
        : token.length <= 2
          ? token.toUpperCase()
          : token[0].toUpperCase() + token.slice(1),
    )
    .join(" ");
};
