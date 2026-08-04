import { useEffect, useState } from "react";
import type { ModelShortcuts, SessionEffort } from "../../api.ts";
import {
  Combobox,
  type ComboboxGroup,
  type ComboboxItem,
} from "../../design-system/actions/combobox.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useModels, useSession, useUpdateSession } from "../../state/sessions.ts";

// The image-model picker entry that means "image generation off". Model ids
// are always `provider:model`, so a real model can never collide with it.
const IMAGE_MODEL_NONE = "None";

// The effort control's segments, lowest first.
const EFFORT_OPTIONS: readonly SegmentedOption<SessionEffort>[] = [
  { value: "low", label: "low" },
  // "med" keeps the segment widths even; the stored value stays "medium".
  { value: "medium", label: "med" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

// A modality's configured shortcuts as the picker's pinned "kiri" group — the
// shortcut name alone as the label, its configured model id as the committed
// value, in config order. Absent or empty shortcuts pin nothing.
const shortcutGroup = (shortcuts: ModelShortcuts | undefined): ComboboxGroup[] => {
  const entries = Object.entries(shortcuts ?? {});
  return entries.length > 0
    ? [{ label: "kiri", options: entries.map(([name, id]) => ({ value: id, label: name })) }]
    : [];
};

// The model listing as one picker group per provider, providers and models
// sorted. The group heading names the provider, so each option's label drops
// the `provider:` prefix; committed values stay the full ids.
const providerGroups = (ids: readonly string[]): ComboboxGroup[] => {
  const byProvider = new Map<string, ComboboxItem[]>();
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const id of sorted) {
    const split = id.indexOf(":");
    const provider = split === -1 ? id : id.slice(0, split);
    const item = { value: id, label: split === -1 ? id : id.slice(split + 1) };
    const items = byProvider.get(provider);
    if (items) items.push(item);
    else byProvider.set(provider, [item]);
  }
  // Ids were sorted up front, so each provider's items are already in order
  // and the providers surface in first-appearance (sorted) order.
  return [...byProvider.entries()].map(([provider, options]) => ({ label: provider, options }));
};

// The rename control: a text field holding the session's title, committed on
// blur or Enter (the wrapping form catches Enter's submit). A committed blank
// clears the title back to the untitled fallback; a committed no-change is
// dropped rather than PATCHed. The draft re-seeds whenever the stored title
// changes — kiri's generated title lands through the same session query — so
// an un-edited field follows along.
function SessionTitleField({
  title,
  onCommit,
}: {
  title: string | null;
  onCommit: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(title ?? "");
  useEffect(() => {
    setDraft(title ?? "");
  }, [title]);
  const commit = () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === (title ?? null)) {
      setDraft(title ?? "");
      return;
    }
    onCommit(next);
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      onBlur={commit}
      className="flex flex-col"
    >
      <TextInput label="Title" value={draft} onChange={setDraft} placeholder="Name this session…" />
    </form>
  );
}

/**
 * The session chat rail's controls: the session's title (editable — commit
 * renames, clearing restores the untitled fallback) and its model group — the
 * conversation model, the effort level, the image model, and the working
 * directory (display-only). The session's
 * vitals (context fill, start time) live in `SessionVitals` below it. Reads
 * the same shared session query the chat body uses (no second fetch) and
 * renders nothing until it resolves.
 */
export function SessionAside({ id }: { id: string }) {
  const detail = useSession(id).data;
  const { setModel, setImageModel, setEffort, setTitle } = useUpdateSession(id);
  const modelsQuery = useModels();
  const modelsData = modelsQuery.data;
  // While the listing is still in flight there is nothing to label the
  // committed value with: the pinned-current fallback would show the bare
  // model name and then be relabelled the moment the listing lands (a
  // shortcut model becomes its shortcut name) — a visible flash. Until the query settles
  // the pickers render the value with a blank label, disabled. A failed query
  // settles too, so the fallback label then applies and stays stable.
  const modelsPending = modelsQuery.isPending;
  const models = modelsData?.models ?? [];
  const modelFailures = modelsData?.failures ?? [];
  if (!detail) return null;
  const { session } = detail;
  // Pin the current model into the options even if the provider no longer lists
  // it, so the control always has a value to show. Only text-output models can
  // hold a conversation, so only they are offered. Sorted so the long list is
  // scannable. Swapping is blocked mid-turn: the in-flight turn already
  // resolved its model and the change applies next.
  const modelIds = models.filter((model) => model.output === "text").map((model) => model.id);
  const withCurrent = modelIds.includes(session.model) ? modelIds : [session.model, ...modelIds];
  // Configured shortcuts lead the picker as the pinned "kiri" group; the full
  // listing follows, one group per provider.
  const modelOptions = modelsPending
    ? [{ options: [{ value: session.model, label: "" }] }]
    : [...shortcutGroup(modelsData?.shortcuts?.text), ...providerGroups(withCurrent)];
  const turnInFlight = session.status === "running";

  // Image model, same pattern: image-output models only, `None` leading as
  // the off option, the selected model pinned even if delisted. The picker
  // hides entirely when no provider offers an image model and none is
  // selected — image generation simply isn't available.
  const imageModelIds = models.filter((model) => model.output === "image").map((model) => model.id);
  const withCurrentImageModel =
    session.imageModel && !imageModelIds.includes(session.imageModel)
      ? [session.imageModel, ...imageModelIds]
      : imageModelIds;
  // While pending, only a committed model id is blanked — the `None` label
  // is stable (nothing in the listing ever relabels it), so it never flashes.
  const imageModelOptions = modelsPending
    ? [
        {
          options: [
            session.imageModel
              ? { value: session.imageModel, label: "" }
              : { value: IMAGE_MODEL_NONE, label: IMAGE_MODEL_NONE },
          ],
        },
      ]
    : [
        ...shortcutGroup(modelsData?.shortcuts?.image),
        { options: [IMAGE_MODEL_NONE] },
        ...providerGroups(withCurrentImageModel),
      ];
  const showImageModel = withCurrentImageModel.length > 0;

  return (
    <div className="space-y-8">
      {/* Renaming never touches the turn, so — like pinning — it stays
          available while one is in flight. */}
      <SessionTitleField title={session.title} onCommit={(title) => void setTitle(title)} />
      <section className="space-y-4">
        <Combobox
          label="Model"
          options={modelOptions}
          value={session.model}
          disabled={turnInFlight || modelsPending}
          onChange={(model) => void setModel(model)}
        />
        {/* Effort always applies — the system prompt calibrates the
            assistant's thoroughness to it on every model, and the turn adds
            provider reasoning parameters where the model supports them — so
            the control always shows. Like a model swap, a change applies
            from the next turn. */}
        <SegmentedControl
          label="Effort"
          options={EFFORT_OPTIONS}
          value={session.effort}
          disabled={turnInFlight}
          onChange={(effort) => void setEffort(effort)}
        />
        {showImageModel ? (
          <Combobox
            label="Image model"
            options={imageModelOptions}
            value={session.imageModel ?? IMAGE_MODEL_NONE}
            disabled={turnInFlight || modelsPending}
            onChange={(value) => void setImageModel(value === IMAGE_MODEL_NONE ? null : value)}
          />
        ) : null}
        {/* Where the session is working. Display-only by design: the
            assistant moves the directory through its own sandbox-validated
            tool, and the app offers no path entry to get wrong. */}
        {session.cwd ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-xs tracking-widest text-ink-muted uppercase">
              Working directory
            </span>
            <p className="break-all font-mono text-xs text-ink">{session.cwd}</p>
          </div>
        ) : null}
        {/* A provider whose listing failed leaves a gap in the picker; name it
            and why, so a missing model reads as a config issue, not an absence. */}
        {modelFailures.length > 0 ? (
          <div className="space-y-3">
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
    </div>
  );
}
