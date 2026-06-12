// Placeholder names are ASCII-only [A-Z_][A-Z0-9_]* — the same set the
// script bundles' awk renderer matches under LC_ALL=C — so prompt
// templates are portable between bundles and first-party llm steps.
const PLACEHOLDER = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

/**
 * Render `{{VAR}}` placeholders in a prompt template from `vars`, in a
 * single left-to-right pass. Unknown names resolve to the empty string.
 * Substituted values are never re-scanned: a value containing `{{X}}`
 * stays literal in the output.
 */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => vars[name] ?? "");
}
