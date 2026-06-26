import { humaniseSlug } from "../../../shared/humanise-slug.ts";
import { Combobox } from "../../design-system/actions/combobox.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, usePersonas, useSession, useUpdateSession } from "../../state/sessions.ts";
import { contextWindowForModel, currentContextTokens } from "./context-usage.ts";

// Each rail section carries its own vertical rhythm; the divide-y draws the
// hairline between adjacent ones, the first/last reset keeps the edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

// The picker entry that means "no persona". A persona file literally named
// "None" would collide with it — an acceptable edge for a personal tool.
const PERSONA_NONE = "None";

/**
 * The session chat right rail: the session's model, the current context fill,
 * and when it started. Reads the same shared session
 * query the chat body uses (no second fetch) and renders nothing until it
 * resolves. `now` is injectable so tests render a deterministic relative
 * timestamp.
 */
export function SessionAside({ id, now }: { id: string; now?: Date }) {
  const detail = useSession(id).data;
  const { setModel, setPersona } = useUpdateSession(id);
  const modelsData = useModels().data;
  const models = modelsData?.models ?? [];
  const modelFailures = modelsData?.failures ?? [];
  const personas = usePersonas().data ?? [];
  if (!detail) return null;
  const { session } = detail;
  const contextTokens = currentContextTokens(detail.messages);
  const contextLimit = contextWindowForModel(models, session.model);
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
  // the workspace no longer defines it, so the control can show and clear it —
  // humanising its id for the label since the server no longer lists it. `None`
  // leads the list as the detach option. The picker hides entirely when there
  // are no personas to choose and none is attached.
  const personaItems =
    session.persona && !personas.some((p) => p.id === session.persona)
      ? [{ id: session.persona, name: humaniseSlug(session.persona) }, ...personas]
      : personas;
  const personaOptions = [
    { value: PERSONA_NONE, label: "None" },
    ...personaItems.map((p) => ({ value: p.id, label: p.name })),
  ];
  const showPersona = personaItems.length > 0;

  return (
    <div className="divide-y divide-rule">
      <section className={SECTION_CLASS}>
        <Combobox
          label="Model"
          options={modelOptions}
          value={session.model}
          disabled={turnInFlight}
          onChange={(model) => void setModel(model)}
        />
        {/* A provider whose listing failed leaves a gap in the picker; name it
            and why, so a missing model reads as a config issue, not an absence. */}
        {modelFailures.length > 0 ? (
          <div className="mt-4 space-y-3">
            {modelFailures.map((failure) => (
              <Notice
                key={failure.provider}
                tone="negative"
                announce="polite"
                title={`${failure.provider} models unavailable`}
              >
                {failure.reason}
              </Notice>
            ))}
          </div>
        ) : null}
      </section>
      {showPersona ? (
        <section className={SECTION_CLASS}>
          <Combobox
            label="Persona"
            options={personaOptions}
            value={session.persona ?? PERSONA_NONE}
            disabled={turnInFlight}
            onChange={(value) => void setPersona(value === PERSONA_NONE ? null : value)}
          />
        </section>
      ) : null}
      {contextTokens !== undefined ? (
        <section className={SECTION_CLASS}>
          <Eyebrow tone="muted">Context</Eyebrow>
          <p className="mt-1 font-mono text-sm text-ink tabular-nums">
            {contextLimit !== undefined
              ? `${contextTokens.toLocaleString("en")} / ${contextLimit.toLocaleString("en")} tokens`
              : `${contextTokens.toLocaleString("en")} tokens`}
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
