import { z } from "zod";
import type { WorkflowDefinition, WorkflowInput } from "./schema.ts";

const buildField = (input: WorkflowInput): z.ZodTypeAny => {
  const requiredMessage = `input "${input.name}" is required`;
  const options = input.options;
  const enumSchema = options
    ? z.enum(options as [string, ...string[]], {
        error: (issue) =>
          `input "${input.name}" value "${String(issue.input)}" is not one of the declared options`,
      })
    : null;

  if (input.required) {
    // Pipe through the enum (when there are options) so the string-length
    // check fires first — empty string on a required picklist reports
    // "is required" rather than "not one of the declared options".
    const required = z.string({ message: requiredMessage }).min(1, { message: requiredMessage });
    return enumSchema ? required.pipe(enumSchema) : required;
  }
  return enumSchema ? enumSchema.optional() : z.string().optional();
};

/**
 * Build a Zod schema for a workflow's invoke payload. Strict object whose
 * keys are the declared input names, typed per each input's `required`
 * and `options` flags. Workflows with no `inputs:` collapse to a strict
 * empty object — any supplied keys surface as `unrecognized_keys` issues.
 *
 * Hand the schema to `safeParse` and route its `ZodError` through
 * `zodErrorBody` for the same `{ error, issues }` response shape as
 * body validation.
 */
export const buildInputSchema = (def: WorkflowDefinition) => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const input of def.inputs ?? []) {
    shape[input.name] = buildField(input);
  }
  return z.object(shape).strict();
};
