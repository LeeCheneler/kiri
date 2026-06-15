import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Stat, StatList } from "../../design-system/content/stat.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useSession } from "../../state/sessions.ts";

// Each rail section carries its own vertical rhythm; the divide-y draws the
// hairline between adjacent ones, the first/last reset keeps the edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

/**
 * The session chat right rail: the session's model, running token totals, and
 * when it started. Reads the same shared session query the chat body uses (no
 * second fetch) and renders nothing until it resolves. `now` is injectable so
 * tests render a deterministic relative timestamp.
 */
export function SessionAside({ id, now }: { id: string; now?: Date }) {
  const session = useSession(id).data?.session;
  if (!session) return null;

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
      <section className={SECTION_CLASS}>
        <Eyebrow tone="muted">Started</Eyebrow>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {formatRelativeTime(session.startedAt, now)}
        </p>
      </section>
    </div>
  );
}
