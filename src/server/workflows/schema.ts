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

/** Zod schema for a YAML workflow definition. */
export const workflowSchema = z
  .object({
    name: z.string().min(1),
    steps: z.array(stepSchema).min(1),
    gating: z.enum(["auto", "propose"]).optional(),
    schedule: z.string().min(1).optional(),
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof stepSchema>;
export type UseStep = z.infer<typeof useStepSchema>;
export type ShStep = z.infer<typeof shStepSchema>;
export type Gating = "auto" | "propose";

/** Type guard: a step is a `use:` bundle reference. */
export const isUseStep = (step: WorkflowStep): step is UseStep => "use" in step;

/** Type guard: a step is an inline `sh:` shell snippet. */
export const isShStep = (step: WorkflowStep): step is ShStep => "sh" in step;
