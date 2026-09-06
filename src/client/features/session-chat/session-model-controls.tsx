import { useEffect } from "react";
import type { SessionEffort } from "../../api.ts";
import { Combobox } from "../../design-system/actions/combobox.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { Popover } from "../../design-system/surfaces/popover.tsx";
import { useModels, useSession, useUpdateSession } from "../../state/sessions.ts";
import { providerGroups, shortcutGroup } from "./model-options.ts";
import { DEFAULT_INPUT_LABEL, type PushToTalkState } from "./use-push-to-talk.ts";

/** The slice of push-to-talk the settings popover drives: which microphone it listens to. */
export type MicrophoneState = Pick<
  PushToTalkState,
  "available" | "status" | "inputs" | "deviceId" | "setDevice" | "refreshInputs"
>;

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

/** A cog, named for assistive tech since the glyph says nothing on its own. */
function SettingsGlyph() {
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="inline-block h-4 w-4 align-middle">
        {/* An eight-toothed gear around a hub. */}
        <path
          d="M8.00 2.80 L8.88 1.06 L10.27 1.38 L10.29 3.33 L11.68 4.32 L13.53 3.71 L14.29 4.92 L12.92 6.32 L13.20 8.00 L14.94 8.88 L14.62 10.27 L12.67 10.29 L11.68 11.68 L12.29 13.53 L11.08 14.29 L9.68 12.92 L8.00 13.20 L7.12 14.94 L5.73 14.62 L5.71 12.67 L4.32 11.68 L2.47 12.29 L1.71 11.08 L3.08 9.68 L2.80 8.00 L1.06 7.12 L1.38 5.73 L3.33 5.71 L4.32 4.32 L3.71 2.47 L4.92 1.71 L6.32 3.08 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span className="sr-only">settings</span>
    </>
  );
}

/**
 * The microphone push-to-talk listens to: the browser's default or one of
 * the inputs it lists. The popover mounts its contents on open, so mounting
 * re-lists, picking up a device plugged in since. Locked while a hold or
 * its transcription is in progress — that capture has its microphone.
 */
function MicrophonePicker({ microphone }: { microphone: MicrophoneState }) {
  const { status, inputs, deviceId, setDevice, refreshInputs } = microphone;
  useEffect(() => {
    refreshInputs();
  }, [refreshInputs]);
  return (
    <Select
      label="Microphone"
      value={deviceId ?? ""}
      disabled={status !== "idle"}
      onChange={(value) => setDevice(value === "" ? undefined : value)}
    >
      <option value="">{DEFAULT_INPUT_LABEL}</option>
      {inputs.map((input) => (
        <option key={input.id} value={input.id}>
          {input.label || input.id}
        </option>
      ))}
    </Select>
  );
}

/**
 * The session's settings, folded behind a "settings" button in the message
 * composer's toolbar: the popover holds the conversation model, the effort
 * level, the image model (offered only when a provider lists one), and the
 * microphone push-to-talk listens to (offered only while push-to-talk is
 * available), so what handles the next message is chosen where it's typed
 * without the controls crowding the toolbar. The model controls commit on
 * change and apply from the next turn, and lock while a turn is in flight,
 * since that turn has already resolved them. Reads the same shared session
 * query the chat body uses and renders nothing until it resolves.
 */
export function SessionModelControls({
  id,
  microphone,
}: {
  id: string;
  microphone?: MicrophoneState;
}) {
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
    <Popover trigger={<SettingsGlyph />} label="Settings" align="end">
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
        {microphone?.available ? <MicrophonePicker microphone={microphone} /> : null}
      </div>
    </Popover>
  );
}
