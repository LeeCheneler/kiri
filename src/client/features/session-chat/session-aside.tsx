import { type SessionMessage, patchSessionModel } from "../../api.ts";
import { Combobox } from "../../design-system/actions/combobox.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Stat, StatList } from "../../design-system/content/stat.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, useSession } from "../../state/sessions.ts";

// Each rail section carries its own vertical rhythm; the divide-y draws the
// hairline between adjacent ones, the first/last reset keeps the edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

// The live context fill, approximated by the most recent settled turn's
// footprint: the tokens it sent (all prior messages) plus the reply it
// produced, now part of history. The session's cumulative totals count every
// turn's resend, so they overstate it. `undefined` until a turn has settled
// with reported usage — there's nothing meaningful to show before then.
function currentContextTokens(messages: SessionMessage[]): number | undefined {
  const usage = messages.findLast((message) => message.usage)?.usage;
  if (!usage || usage.inputTokens === undefined) return undefined;
  return usage.inputTokens + (usage.outputTokens ?? 0);
}

/**
 * The session chat right rail: the session's model, running token totals, the
 * current context fill, and when it started. Reads the same shared session
 * query the chat body uses (no second fetch) and renders nothing until it
 * resolves. `now` is injectable so tests render a deterministic relative
 * timestamp.
 */
export function SessionAside({ id, now }: { id: string; now?: Date }) {
  const detail = useSession(id).data;
  const models = useModels().data?.models ?? [];
  if (!detail) return null;
  const { session } = detail;
  const contextTokens = currentContextTokens(detail.messages);
  // Pin the current model into the options even if the provider no longer lists
  // it, so the control always has a value to show. Sorted so the long list is
  // scannable. Swapping is blocked mid-turn: the in-flight turn already resolved
  // its model and the change applies next.
  const modelIds = models.map((model) => model.id);
  const withCurrent = modelIds.includes(session.model) ? modelIds : [session.model, ...modelIds];
  const modelOptions = [...withCurrent].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const turnInFlight = session.status === "running";

  return (
    <div className="divide-y divide-rule">
      <section className={SECTION_CLASS}>
        <Combobox
          label="Model"
          options={modelOptions}
          value={session.model}
          disabled={turnInFlight}
          onChange={(model) => void patchSessionModel(id, model)}
        />
      </section>
      <section className={SECTION_CLASS}>
        <Eyebrow tone="muted">Tokens</Eyebrow>
        <div className="mt-3">
          <StatList>
            <Stat label="in" size="sm">
              {session.inputTokens}
            </Stat>
            <Stat label="out" size="sm">
              {session.outputTokens}
            </Stat>
            <Stat label="total" size="sm">
              {session.totalTokens}
            </Stat>
          </StatList>
        </div>
      </section>
      {contextTokens !== undefined ? (
        <section className={SECTION_CLASS}>
          <Eyebrow tone="muted">Context</Eyebrow>
          <p className="mt-1 font-mono text-sm text-ink tabular-nums">
            {`${contextTokens.toLocaleString("en")} tokens`}
          </p>
        </section>
      ) : null}
      <section className={SECTION_CLASS}>
        <Eyebrow tone="muted">Started</Eyebrow>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {formatRelativeTime(session.startedAt, now)}
        </p>
      </section>
    </div>
  );
}
