import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { useRun } from "../../state/runs.ts";

/**
 * The run detail right rail: the run's invocation inputs. Reads the same
 * shared run query the page body uses (no second fetch) and renders nothing
 * until it resolves — and nothing at all for a run with no inputs, so the
 * rail stays empty rather than showing a bare heading.
 */
export function RunAside({ id }: { id: string }) {
  const detail = useRun(id).data?.run;
  if (!detail) return null;

  const { inputs } = detail;
  if (inputs === null || Object.keys(inputs).length === 0) return null;

  return (
    <section>
      <Eyebrow tone="muted">Inputs</Eyebrow>
      <dl className="mt-3 space-y-3">
        {Object.entries(inputs).map(([name, value]) => (
          <div key={name}>
            <dt className="font-mono text-xs text-ink-muted">{name}</dt>
            <dd className="mt-0.5 font-mono text-sm break-words whitespace-pre-wrap text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
