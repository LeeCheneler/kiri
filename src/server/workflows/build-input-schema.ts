import { z } from "zod";
import type { WorkflowDefinition, WorkflowInput } from "./schema.ts";

const buildField = (input: WorkflowInput): z.ZodTypeAny => {
  const requiredMessage = `input "${input.name}" is required`;

  const stringSchema = input.required
    ? z.string({ message: requiredMessage }).min(1, { message: requiredMessage })
    : z.string();

  let valueSchema: z.ZodTypeAny = stringSchema;
  if (input.options) {
    const options = input.options;
    // superRefine (not z.enum) so the failure message can interpolate the
    // declined value and the input name in our canonical phrasing. The
    // refine is skipped automatically when the string-level checks fail,
    // which is what makes empty-string on a required picklist report
    // "is required" rather than "not one of options".
    valueSchema = stringSchema.superRefine((value, ctx) => {
      if (!options.includes(value)) {
        ctx.addIssue({
          code: "custom",
          message: `input "${input.name}" value "${value}" is not one of the declared options`,
        });
      }
    });
  }

  return input.required ? valueSchema : valueSchema.optional();
};

/**
 * Build a Zod schema for a workflow's invoke payload. Strict object whose
 * keys are the declared input names, typed per each input's `required`
 * and `options` flags. Workflows with no `inputs:` collapse to a strict
 * empty object — any supplied keys surface as `unrecognized_keys` issues.
 *
 * Pair with `validateInputs` (for the legacy `{ ok, error }` contract)
 * or hand the schema to `safeParse` directly and route its `ZodError`
 * through `zodErrorBody` for the same `{ error, issues }` response shape
 * as body validation.
 */
export const buildInputSchema = (def: WorkflowDefinition) => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const input of def.inputs ?? []) {
    shape[input.name] = buildField(input);
  }
  return z.object(shape).strict();
};
