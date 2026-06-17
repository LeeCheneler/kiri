import { type SessionMessage, patchSessionModel, patchSessionPersona } from "../../api.ts";
import { Combobox } from "../../design-system/actions/combobox.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Stat, StatList } from "../../design-system/content/stat.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, usePersonas, useSession } from "../../state/sessions.ts";

// Each rail section carries its own vertical rhythm; the divide-y draws the
// hairline between adjacent ones, the first/last reset keeps the edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

// The picker entry that means "no persona". A persona file literally named
// "None" would collide with it — an acceptable edge for a personal tool.
const PERSONA_NONE = "None";

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
  const personas = usePersonas().data ?? [];
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

  // Persona, same pattern as model: pin the attached one into the list even if
  // the workspace no longer defines it, so the control can show and clear it.
  // `None` leads the list as the detach option. The picker hides entirely when
  // there are no personas to choose and none is attached.
  const personaNames =
    session.persona && !personas.includes(session.persona)
      ? [session.persona, ...personas]
      : personas;
  const personaOptions = [PERSONA_NONE, ...personaNames];
  const showPersona = personaNames.length > 0;

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
      {showPersona ? (
        <section className={SECTION_CLASS}>
          <Combobox
            label="Persona"
            options={personaOptions}
            value={session.persona ?? PERSONA_NONE}
            disabled={turnInFlight}
            onChange={(name) => void patchSessionPersona(id, name === PERSONA_NONE ? null : name)}
          />
        </section>
      ) : null}
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
