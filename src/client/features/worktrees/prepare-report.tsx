import type { PrepareReport as Report } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Tag } from "../../design-system/content/tag.tsx";

// A captured stream from a failed step. Only failed steps carry output, so a
// present stream is always worth reading in full.
function Stream({ label, body }: { label: string; body: string }) {
  return (
    <div className="mt-2">
      <Eyebrow tone="muted">{label}</Eyebrow>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-ink-muted text-xs">
        {body}
      </pre>
    </div>
  );
}

/**
 * The prep pipeline's report for a freshly created worktree: every action it
 * took, in execution order, each tagged with how it went. A failed step also
 * shows its reason and whatever it printed, so the cause is readable without
 * leaving the dialog. The pipeline stops at the first failure, so the last step
 * listed is the one that needs attention.
 */
export function PrepareReport({ report }: { report: Report }) {
  return (
    <div>
      <Eyebrow tone="muted">Setup</Eyebrow>
      <ul className="mt-2 space-y-3">
        {report.steps.map((step) => (
          <li key={step.name}>
            <p className="flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
              {step.name}
              <Tag tone={step.status === "ok" ? "positive" : "negative"}>{step.status}</Tag>
            </p>
            {step.error ? (
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-status-failed text-xs">
                {step.error}
              </pre>
            ) : null}
            {step.stdout ? <Stream label="stdout" body={step.stdout} /> : null}
            {step.stderr ? <Stream label="stderr" body={step.stderr} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
