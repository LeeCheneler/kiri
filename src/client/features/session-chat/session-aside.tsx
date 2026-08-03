import type { ModelTiers, SessionEffort } from "../../api.ts";
import {
  Combobox,
  type ComboboxGroup,
  type ComboboxItem,
} from "../../design-system/actions/combobox.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useModels, useSession, useUpdateSession } from "../../state/sessions.ts";
import { contextWindowForModel, currentContextTokens } from "./context-usage.ts";

// Each rail section carries its own vertical rhythm; the divide-y draws the
// hairline between adjacent ones, the first/last reset keeps the edges flush.
const SECTION_CLASS = "py-6 first:pt-0 last:pb-0";

// The image-model picker entry that means "image generation off". Model ids
// are always `provider:model`, so a real model can never collide with it.
const IMAGE_MODEL_NONE = "None";

// The effort control's segments, lowest first.
const EFFORT_OPTIONS: readonly SegmentedOption<SessionEffort>[] = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
];

// A modality's configured tiers as the picker's pinned "kiri" group — the
// tier name alone as the label, its configured model id as the committed
// value, smallest tier first. Absent tiers pin nothing.
const tierGroup = (tiers: ModelTiers | undefined): ComboboxGroup[] =>
  tiers
    ? [
        {
          label: "kiri",
          options: (["tanto", "katana", "odachi"] as const).map((tier) => ({
            value: tiers[tier],
            label: tier,
          })),
        },
      ]
    : [];

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

/**
 * The session chat right rail: the session's model (with whether it accepts
 * image input, when known), the current context fill,
 * and when it started. Reads the same shared session
 * query the chat body uses (no second fetch) and renders nothing until it
 * resolves. `now` is injectable so tests render a deterministic relative
 * timestamp.
 */
export function SessionAside({ id, now }: { id: string; now?: Date }) {
  const detail = useSession(id).data;
  const { setModel, setImageModel, setEffort } = useUpdateSession(id);
  const modelsQuery = useModels();
  const modelsData = modelsQuery.data;
  // While the listing is still in flight there is nothing to label the
  // committed value with: the pinned-current fallback would show the bare
  // model name and then be relabelled the moment the listing lands (a tier
  // model becomes its tier name) — a visible flash. Until the query settles
  // the pickers render the value with a blank label, disabled. A failed query
  // settles too, so the fallback label then applies and stays stable.
  const modelsPending = modelsQuery.isPending;
  const models = modelsData?.models ?? [];
  const modelFailures = modelsData?.failures ?? [];
  if (!detail) return null;
  const { session } = detail;
  const contextTokens = currentContextTokens(detail.messages);
  const contextLimit = contextWindowForModel(models, session.model);
  // Pin the current model into the options even if the provider no longer lists
  // it, so the control always has a value to show. Only text-output models can
  // hold a conversation, so only they are offered. Sorted so the long list is
  // scannable. Swapping is blocked mid-turn: the in-flight turn already
  // resolved its model and the change applies next.
  const modelIds = models.filter((model) => model.output === "text").map((model) => model.id);
  const withCurrent = modelIds.includes(session.model) ? modelIds : [session.model, ...modelIds];
  // Configured tiers lead the picker as the pinned "kiri" group; the full
  // listing follows, one group per provider.
  const modelOptions = modelsPending
    ? [{ options: [{ value: session.model, label: "" }] }]
    : [...tierGroup(modelsData?.tiers?.text), ...providerGroups(withCurrent)];
  const turnInFlight = session.status === "running";

  // Whether the selected model accepts image input, when its provider's
  // listing says either way. Unknown (a bare listing, or a pinned model the
  // provider no longer lists) shows nothing rather than a guess.
  const imageInput = models.find((model) => model.id === session.model)?.imageInput;

  // The effort control is only offered where effort means something: the
  // selected model's listing must mark it reasoning-capable. A delisted or
  // unmarked model hides the control — the turn wouldn't send reasoning
  // parameters for it anyway.
  const showEffort = models.find((model) => model.id === session.model)?.reasoning === true;

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
        ...tierGroup(modelsData?.tiers?.image),
        { options: [IMAGE_MODEL_NONE] },
        ...providerGroups(withCurrentImageModel),
      ];
  const showImageModel = withCurrentImageModel.length > 0;

  return (
    <div className="divide-y divide-rule">
      <section className={SECTION_CLASS}>
        <Combobox
          label="Model"
          options={modelOptions}
          value={session.model}
          disabled={turnInFlight || modelsPending}
          onChange={(model) => void setModel(model)}
        />
        {imageInput !== undefined ? (
          <div className="mt-2">
            <Meta>{imageInput ? "Accepts image input" : "Text input only"}</Meta>
          </div>
        ) : null}
        {/* Like a model swap, an effort change applies from the next turn. */}
        {showEffort ? (
          <div className="mt-4">
            <SegmentedControl
              label="Effort"
              options={EFFORT_OPTIONS}
              value={session.effort}
              disabled={turnInFlight}
              onChange={(effort) => void setEffort(effort)}
            />
          </div>
        ) : null}
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
      {showImageModel ? (
        <section className={SECTION_CLASS}>
          <Combobox
            label="Image model"
            options={imageModelOptions}
            value={session.imageModel ?? IMAGE_MODEL_NONE}
            disabled={turnInFlight || modelsPending}
            onChange={(value) => void setImageModel(value === IMAGE_MODEL_NONE ? null : value)}
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
