import { z } from "zod";

/**
 * Brand stamped onto values produced by `defineWorkflow` so the loader can
 * pick them out of a module's exports without guessing. `Symbol.for` keeps
 * the brand stable across dynamic imports of the same module URL.
 *
 * `as never` is the standard widening cast: `Symbol.for(...)` returns
 * `symbol`, but we declare a `unique symbol` (needed to use the value as a
 * computed property key type). `as unique symbol` is rejected by the
 * compiler — `unique symbol` is not allowed in assertion positions.
 */
export const WORKFLOW_BRAND: unique symbol = Symbol.for("kiri.workflow") as never;

export interface ScriptNode {
  kind: "script";
  path: string;
}

export type WorkflowNode = ScriptNode;

export type Gating = "auto" | "propose";

export interface WorkflowDefinition<TInput extends z.ZodType = z.ZodType> {
  name: string;
  inputSchema: TInput;
  nodes: WorkflowNode[];
  gating?: Gating;
  schedule?: string;
}

export type BrandedWorkflowDefinition<TInput extends z.ZodType = z.ZodType> =
  WorkflowDefinition<TInput> & {
    readonly [WORKFLOW_BRAND]: true;
  };

const scriptNodeSchema = z.object({
  kind: z.literal("script"),
  path: z.string().min(1),
});

const workflowNodeSchema = z.discriminatedUnion("kind", [scriptNodeSchema]);

const workflowDefinitionSchema = z.object({
  name: z.string().min(1),
  inputSchema: z.custom<z.ZodType>((v) => v instanceof z.ZodType, {
    error: "inputSchema must be a Zod schema",
  }),
  nodes: z.array(workflowNodeSchema).min(1),
  gating: z.enum(["auto", "propose"]).optional(),
  schedule: z.string().min(1).optional(),
});

/**
 * Define a kiri workflow. Validates the shape with Zod and stamps a brand
 * the loader uses to identify workflow exports. Throws a `ZodError` on an
 * invalid shape — the loader catches and re-surfaces with the file path.
 */
export function defineWorkflow<TInput extends z.ZodType>(
  def: WorkflowDefinition<TInput>,
): BrandedWorkflowDefinition<TInput> {
  workflowDefinitionSchema.parse(def);
  return { ...def, [WORKFLOW_BRAND]: true } as BrandedWorkflowDefinition<TInput>;
}

/** Type guard for branded workflow definitions returned from `defineWorkflow`. */
export function isWorkflowDefinition(value: unknown): value is BrandedWorkflowDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [WORKFLOW_BRAND]?: unknown })[WORKFLOW_BRAND] === true
  );
}
