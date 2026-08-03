import { Meter } from "../../design-system/charts/meter.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, useSession } from "../../state/sessions.ts";
import {
  CONTEXT_WARNING_RATIO,
  contextWindowForModel,
  currentContextTokens,
} from "./context-usage.ts";

/**
 * The session's vitals at the rail's foot: the context fill as a slim meter
 * (escalating to the warning tone as it nears the model's window) over quiet
 * meta lines with the token numbers and when the session started.
 * The meter needs both a settled context footprint and a catalogued window;
 * with only the footprint the numbers still show, with neither only the start
 * time does. Reads the same shared session query the chat body uses (no
 * second fetch) and renders nothing until it resolves. `now` is injectable so
 * tests render a deterministic relative timestamp.
 */
export function SessionVitals({ id, now }: { id: string; now?: Date }) {
  const detail = useSession(id).data;
  const models = useModels().data?.models ?? [];
  if (!detail) return null;
  const tokens = currentContextTokens(detail.messages);
  const limit = contextWindowForModel(models, detail.session.model);
  return (
    <section className="space-y-2">
      {tokens !== undefined && limit !== undefined ? (
        <Meter
          value={tokens}
          max={limit}
          label="Context used"
          tone={tokens / limit >= CONTEXT_WARNING_RATIO ? "warning" : "accent"}
        />
      ) : null}
      {/* Stacked rather than one Meta row: the token numbers alone nearly
          fill the rail, so a single row would all but always wrap and orphan
          the separator. */}
      {tokens !== undefined ? (
        <Meta>
          <span className="tabular-nums">
            {limit !== undefined
              ? `${tokens.toLocaleString("en")} / ${limit.toLocaleString("en")} tokens`
              : `${tokens.toLocaleString("en")} tokens`}
          </span>
        </Meta>
      ) : null}
      <Meta>
        <span>started {formatRelativeTime(detail.session.startedAt, now)}</span>
      </Meta>
    </section>
  );
}
