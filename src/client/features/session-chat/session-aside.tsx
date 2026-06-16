import type { SessionMessage } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Stat, StatList } from "../../design-system/content/stat.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useSession } from "../../state/sessions.ts";

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
  if (!detail) return null;
  const { session } = detail;
  const contextTokens = currentContextTokens(detail.messages);

  return (
    <div className="divide-y divide-rule">
      <section className={SECTION_CLASS}>
        <Eyebrow tone="muted">Model</Eyebrow>
        <p className="mt-1 font-mono text-sm break-words text-ink">{session.model}</p>
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
