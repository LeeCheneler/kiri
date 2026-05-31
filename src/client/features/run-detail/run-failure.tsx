import { CodeBlock } from "../../design-system/content/code.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { StatusBlock } from "../../design-system/feedback/status-block.tsx";

/**
 * The run-level failure callout: a failed-status block carrying the run's
 * error message, surfaced above the phases so a failure isn't buried inside a
 * step disclosure. The stack (when present) sits behind a disclosure so the
 * message stays readable. Rendered as an `alert` so assistive tech announces
 * it; render only when the run carries an error.
 */
export function RunFailure({ error }: { error: { message: string; stack?: string } }) {
  return (
    <section role="alert" className="mt-8">
      <StatusBlock status="failed">
        <Eyebrow tone="muted">Run failed</Eyebrow>
        <pre className="mt-2 font-mono text-sm break-words whitespace-pre-wrap text-ink">
          {error.message}
        </pre>
        {error.stack ? (
          <div className="mt-3">
            <Disclosure summary={<span className="font-mono text-xs text-ink-muted">stack</span>}>
              <CodeBlock>{error.stack}</CodeBlock>
            </Disclosure>
          </div>
        ) : null}
      </StatusBlock>
    </section>
  );
}
