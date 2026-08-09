import type { SessionEffort } from "../../api.ts";
import { Combobox } from "../../design-system/actions/combobox.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Popover } from "../../design-system/surfaces/popover.tsx";
import { useModels, useSession, useUpdateSession } from "../../state/sessions.ts";
import { providerGroups, shortcutGroup } from "./model-options.ts";

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

/**
 * The session's model group, folded behind a "models" button in the message
 * composer's toolbar: the popover holds the conversation model, the effort
 * level, and the image model (offered only when a provider lists one), so
 * what handles the next message is chosen where it's typed without the
 * controls crowding the toolbar. All commit on change and apply from the next
 * turn; all lock while a turn is in flight, since that turn has already
 * resolved them. Reads the same shared session query the chat body uses and
 * renders nothing until it resolves.
 */
export function SessionModelControls({ id }: { id: string }) {
  const detail = useSession(id).data;
  const { setModel, setImageModel, setEffort } = useUpdateSession(id);
  const modelsQuery = useModels();
  const modelsData = modelsQuery.data;
  // While the listing is still in flight there is nothing to label the
  // committed value with: the pinned-current fallback would show the bare
  // model name and then be relabelled the moment the listing lands (a
  // shortcut model becomes its shortcut name) — a visible flash. Until the
  // query settles the pickers render the value with a blank label, disabled.
  // A failed query settles too, so the fallback label then applies and stays
  // stable.
  const modelsPending = modelsQuery.isPending;
  const models = modelsData?.models ?? [];
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
    // Pinned to the trigger's right edge so the panel stays inside the
    // composer's frame; it picks its own side for the room available.
    <Popover trigger="models" label="Models" align="end">
      <div className="w-64 space-y-4">
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
      </div>
    </Popover>
  );
}
