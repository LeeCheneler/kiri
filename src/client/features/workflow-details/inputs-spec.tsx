import type { WorkflowInputSummary } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";

/**
 * The Inputs tab: a row per declared input — its name, derived type (`enum` when
 * the input constrains to `options`, else `string`), and a required/optional
 * marker — with the default and description stacked beneath when set. Workflows
 * with no `inputs:` block show an empty state.
 */
export function InputsSpec({ inputs }: { inputs?: WorkflowInputSummary[] }) {
  if (!inputs || inputs.length === 0) {
    return <EmptyState>this workflow declares no inputs.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-rule">
      {inputs.map((input) => (
        <li key={input.name} className="flex flex-col gap-2 px-5 py-4">
          <div className="flex items-baseline gap-5">
            <span className="min-w-0 flex-1 font-mono text-sm text-ink">{input.name}</span>
            <span className="shrink-0 font-mono text-xs text-ink-muted">
              {input.options ? "enum" : "string"}
            </span>
            <span
              className={`shrink-0 font-mono text-xs ${
                input.required ? "text-accent" : "text-ink-faint"
              }`}
            >
              {input.required ? "required" : "optional"}
            </span>
          </div>
          {input.default !== undefined && (
            <p className="font-mono text-xs text-ink-muted">
              default: <span className="text-ink">{input.default}</span>
            </p>
          )}
          {input.description !== undefined && input.description.length > 0 && (
            <p className="font-display text-sm text-ink-muted italic">{input.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
