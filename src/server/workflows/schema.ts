import { z } from "zod";

const envValueSchema = z.union([
  z.string(),
  z
    .object({ input: z.string().min(1) })
    .strict()
    .describe(
      "Reference to a workflow input by name. Resolved to the input's string value at spawn time.",
    ),
]);

const envSchema = z
  .record(z.string(), envValueSchema)
  .refine((env) => Object.keys(env).every((key) => !key.startsWith("KIRI_")), {
    message: "env keys starting with 'KIRI_' are reserved",
  });

const useStepSchema = z
  .object({
    use: z.string().min(1),
    description: z.string().min(1).optional(),
    env: envSchema.optional(),
  })
  .strict();

const shStepSchema = z
  .object({
    sh: z.string().min(1),
    description: z.string().min(1).optional(),
    env: envSchema.optional(),
  })
  .strict();

const stepSchema = z.union([useStepSchema, shStepSchema]);

/**
 * Pattern that constrains a published article's `name`. Re-used by the
 * HTTP route that fetches articles by name so the regex lives once and
 * the validation surface matches the schema exactly.
 */
export const publishNameSchema = z.string().regex(/^[a-z0-9-]+$/, {
  message: "publish name must match ^[a-z0-9-]+$",
});

const usePublishSchema = z
  .object({
    name: publishNameSchema,
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    use: z.string().min(1),
    env: envSchema.optional(),
  })
  .strict();

const shPublishSchema = z
  .object({
    name: publishNameSchema,
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
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

const inputSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, {
        message: "input name must match ^[a-z_][a-z0-9_]*$",
      })
      .describe(
        "Identifier used to reference the input from a step's env. Lowercase letters, digits, and underscores; must start with a letter or underscore.",
      ),
    description: z
      .string()
      .min(1)
      .optional()
      .describe("Help text shown next to the field in the invoke modal."),
    required: z
      .boolean()
      .optional()
      .describe(
        "When true, the input must be supplied at invoke. When false or omitted, the input is optional and `default` (if any) pre-fills the modal.",
      ),
    default: z
      .string()
      .optional()
      .describe("Value pre-filled into the modal field when no value is supplied at invoke."),
    options: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "Fixed list of allowed values. When present, the invoke modal renders a picker instead of a text field, `default` (if set) must be one of the entries, and values supplied at invoke must be one of the entries.",
      ),
  })
  .strict();

const inputsArraySchema = z
  .array(inputSchema)
  .min(1)
  .refine((inputs) => new Set(inputs.map((i) => i.name)).size === inputs.length, {
    message: "input names must be unique within a workflow",
  });

const baseWorkflowSchema = z
  .object({
    name: z.string().min(1),
    /**
     * Optional one-line summary of what the workflow does. Rendered as the
     * deck beneath the workflow's title on its detail page.
     */
    description: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Short summary of what the workflow does, shown as the deck beneath the title on the workflow page.",
      ),
    /**
     * Optional grouping label for related workflows (e.g. "Dev"). Rendered
     * as the eyebrow above the workflow's title on its detail page.
     */
    group: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional grouping label for related workflows (e.g. "Dev"), shown as the eyebrow on the workflow page.',
      ),
    /**
     * Optional named parameters collected via a modal at invocation time.
     * A workflow with no `inputs:` runs immediately on invoke; one with
     * `inputs:` collects values via a form before the run starts. Steps
     * reference an input from their `env:` using `{ input: <name> }`.
     */
    inputs: inputsArraySchema
      .optional()
      .describe(
        "Named parameters collected via a modal at invocation time. Each input is a string. Reference an input from a step's env using `{ input: <name> }`.",
      ),
    steps: z.array(stepSchema).min(1),
    /**
     * Optional post-run step whose stdout becomes the run's feed-entry
     * summary. Same shape, validation rules, and reserved-namespace
     * guarantees as a regular step. Runs after `steps:` terminates;
     * failure is non-fatal to the run.
     */
    summarize: stepSchema.optional(),
    /**
     * Optional list of articles the workflow publishes after `steps:`
     * terminates with `ok` or `failed`. Each entry runs through the same
     * executor path as a step; its trimmed stdout is stored as a markdown
     * article keyed by `name`. Names must be unique within a workflow.
     */
    publish: publishArraySchema.optional(),
  })
  .strict();

/**
 * Zod schema for a YAML workflow definition. Beyond the base shape,
 * cross-validates that every `{ input: <name> }` env reference points
 * at a declared input — unknown names fail at load time.
 */
export const workflowSchema = baseWorkflowSchema.superRefine((wf, ctx) => {
  wf.inputs?.forEach((input, i) => {
    if (!input.options) return;
    const seen = new Set<string>();
    for (const option of input.options) {
      if (seen.has(option)) {
        ctx.addIssue({
          code: "custom",
          path: ["inputs", i, "options"],
          message: `input "${input.name}" options contain duplicate value "${option}"`,
        });
        break;
      }
      seen.add(option);
    }
    if (input.default !== undefined && !input.options.includes(input.default)) {
      ctx.addIssue({
        code: "custom",
        path: ["inputs", i, "default"],
        message: `input "${input.name}" default "${input.default}" is not one of the declared options`,
      });
    }
  });

  const declared = new Set((wf.inputs ?? []).map((i) => i.name));
  const checkEnv = (
    env: Record<string, z.infer<typeof envValueSchema>> | undefined,
    path: Array<string | number>,
  ): void => {
    if (!env) return;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") continue;
      if (!declared.has(value.input)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "env", key, "input"],
          message: `env "${key}" references undeclared input "${value.input}"`,
        });
      }
    }
  };
  wf.steps.forEach((step, i) => checkEnv(step.env, ["steps", i]));
  if (wf.summarize) checkEnv(wf.summarize.env, ["summarize"]);
  wf.publish?.forEach((entry, i) => checkEnv(entry.env, ["publish", i]));
});

export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type UseStep = z.infer<typeof useStepSchema>;
export type ShStep = z.infer<typeof shStepSchema>;
export type PublishEntry = z.infer<typeof publishEntrySchema>;
export type UsePublish = z.infer<typeof usePublishSchema>;
export type ShPublish = z.infer<typeof shPublishSchema>;
export type WorkflowInput = z.infer<typeof inputSchema>;
export type EnvValue = z.infer<typeof envValueSchema>;

/** Type guard: a step is a `use:` bundle reference. */
export const isUseStep = (step: WorkflowStep): step is UseStep => "use" in step;

/** Type guard: a step is an inline `sh:` shell snippet. */
export const isShStep = (step: WorkflowStep): step is ShStep => "sh" in step;

/** Type guard: a publish entry is a `use:` bundle reference. */
export const isUsePublish = (entry: PublishEntry): entry is UsePublish => "use" in entry;

/** Type guard: a publish entry is an inline `sh:` shell snippet. */
export const isShPublish = (entry: PublishEntry): entry is ShPublish => "sh" in entry;
