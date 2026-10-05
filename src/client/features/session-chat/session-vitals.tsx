import { Meter } from "../../design-system/charts/meter.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { useModels, useSession } from "../../state/sessions.ts";
import {
  CONTEXT_WARNING_RATIO,
  contextWindowForModel,
  currentContextTokens,
} from "./context-usage.ts";

/** Compact context usage for the composer; hidden until a model-call footprint is known. */
export function SessionVitals({ id }: { id: string }) {
  const detail = useSession(id).data;
  const models = useModels().data?.models ?? [];
  if (!detail) return null;
  const tokens = currentContextTokens(detail.messages);
  if (tokens === undefined) return null;
  const limit = contextWindowForModel(models, detail.session.model);

  return (
    <section aria-label="Context usage" className="flex flex-wrap items-center gap-2">
      {limit !== undefined ? (
        <div className="w-16">
          <Meter
            value={tokens}
            max={limit}
            label="Context used"
            tone={tokens / limit >= CONTEXT_WARNING_RATIO ? "warning" : "accent"}
          />
        </div>
      ) : null}
      <Meta>
        <span className="tabular-nums">
          {limit !== undefined
            ? `${tokens.toLocaleString("en")} / ${limit.toLocaleString("en")} tokens`
            : `${tokens.toLocaleString("en")} tokens`}
        </span>
      </Meta>
    </section>
  );
}
