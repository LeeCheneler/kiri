import type { WorkflowDefinition } from "./schema.ts";

export type ValidateInputsResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a `Record<string, string>` invoke payload against a workflow's
 * declared inputs. Static shape (object whose values are strings) is the
 * caller's job — this layer enforces the workflow-aware rules:
 *
 * - A workflow with no `inputs:` block rejects any non-empty payload
 *   (defensive: the UI shouldn't send one).
 * - Unknown keys (not in `def.inputs`) are rejected.
 * - Inputs declared `required: true` must be present and non-empty.
 *
 * First failure wins so the returned message stays readable; the modal does
 * the multi-field UX, so aggregating here would duplicate that surface.
 */
export const validateInputs = (
  def: WorkflowDefinition,
  supplied: Record<string, string>,
): ValidateInputsResult => {
  const declared = def.inputs;

  if (!declared) {
    const keys = Object.keys(supplied);
    if (keys.length === 0) return { ok: true };
    return {
      ok: false,
      error: `workflow "${def.name}" declares no inputs; received: ${keys.join(", ")}`,
    };
  }

  const declaredNames = new Set(declared.map((i) => i.name));
  for (const key of Object.keys(supplied)) {
    if (!declaredNames.has(key)) {
      return { ok: false, error: `unknown input "${key}"` };
    }
  }

  for (const input of declared) {
    if (!input.required) continue;
    const value = supplied[input.name];
    if (value === undefined || value.length === 0) {
      return { ok: false, error: `input "${input.name}" is required` };
    }
  }

  return { ok: true };
};
