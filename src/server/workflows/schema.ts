import { z } from "zod";

const scriptNodeSchema = z.object({
  kind: z.literal("script"),
  path: z.string().min(1),
});

const workflowNodeSchema = z.discriminatedUnion("kind", [scriptNodeSchema]);

/** Zod schema for a YAML workflow definition. */
export const workflowSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  gating: z.enum(["auto", "propose"]).optional(),
  schedule: z.string().min(1).optional(),
});

export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type ScriptNode = z.infer<typeof scriptNodeSchema>;
export type Gating = "auto" | "propose";
