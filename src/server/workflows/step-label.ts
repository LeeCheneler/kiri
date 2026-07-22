import { type WorkflowStep, isLlmStep, isUseStep } from "./schema.ts";

/**
 * Short display label for a step: the authored `name`, falling back to
 * `id`, then the step's ident — bundle ref, model id, or the script's
 * first non-empty line. Mirrors the fallback order the run timeline uses.
 */
export const stepLabel = (step: WorkflowStep): string => {
  if (step.name !== undefined) return step.name;
  if (step.id !== undefined) return step.id;
  if (isUseStep(step)) return step.use;
  if (isLlmStep(step)) return step.llm.model;
  const firstLine = step.sh.split("\n").find((line) => line.trim() !== "");
  return firstLine?.trim() ?? step.sh;
};
