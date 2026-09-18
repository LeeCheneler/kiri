import type { UIMessage } from "ai";
import {
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ReactNode,
  useId,
  useRef,
} from "react";
import { messagePartsError } from "../../../shared/message-limits.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Field } from "../../design-system/actions/field.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import {
  type StagedAttachment,
  attachmentAccept,
  attachmentName,
  attachmentParts,
  pickedFilesFrom,
} from "./attachments.ts";
import { FileThumb } from "./file-thumb.tsx";
import { ImageThumb } from "./image-thumb.tsx";
import { useStagedAttachments } from "./use-staged-attachments.ts";

/**
 * The shared message composer: one framed surface holding any staged
 * attachments, an auto-growing textarea, and a toolbar — add file on the left;
 * caller controls, an optional cancel, and an optional submit button on the
 * right. Images, documents and text files stage from the file picker (images
 * also from a paste), Enter submits and Shift+Enter breaks a line. Text is
 * controlled via `value`/`onChange`, so the caller owns persistence; staged
 * attachments start from `initialAttachments` and are cleared on submit.
 * `onSubmit` receives the assembled `UIMessage` parts — the attachments in the
 * order they were staged (each text file as an `<attached-file>` text part),
 * then the typed text — and the caller decides what they mean (send a turn,
 * resend an edit); returning `false` refuses the submit — staged attachments
 * stay put for the caller's error to explain. `onCancel`, when given, fires
 * from Escape and a cancel button in the toolbar (e.g. to close an inline
 * editor).
 * While `busy` — a turn is in flight — the field and its controls stay editable
 * so the next message can be drafted, but submitting is blocked until the turn
 * settles. Pass `id` to let the caller focus the field; `label` names the
 * field — visibly by default, or for assistive tech only with `labelHidden`.
 * Enter is the primary submit; pass `submitLabel` to also render a named
 * submit button (an inline editor's "resend"), or omit it for an Enter-only
 * composer — fold the key instructions into the `placeholder` there.
 * `controls` slots caller-owned controls into the toolbar's right side — e.g.
 * the session's model group — laid out by the toolbar row, which wraps when it
 * runs out of width.
 *
 * `acceptsImages: false` — the session's model reads text only — narrows the
 * file picker to text files and turns a picked or pasted image into an inline
 * error pointing at the model picker, instead of staging an attachment the
 * turn would only fail on. Text files stay attachable throughout. Omit it (or
 * pass `true`) when images are fine or the model's input support is unknown.
 * `acceptsDocuments` lists the document media types the model's provider
 * carries (PDF, Office): the picker offers exactly those, and a picked file of
 * any other document type gets the same kind of inline error.
 */

const NO_DOCUMENTS: readonly string[] = [];
const NO_ATTACHMENTS: StagedAttachment[] = [];
export function MessageComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy = false,
  id,
  label,
  labelHidden = false,
  placeholder,
  submitLabel,
  acceptsImages = true,
  acceptsDocuments = NO_DOCUMENTS,
  controls,
  error,
  initialAttachments = NO_ATTACHMENTS,
}: {
  value: string;
  onChange: (value: string) => void;
  // biome-ignore lint/suspicious/noConfusingVoidType: callers that never refuse a submit return nothing; only an explicit `false` refuses it.
  onSubmit: (parts: UIMessage["parts"]) => boolean | undefined | void;
  onCancel?: () => void;
  busy?: boolean;
  id?: string;
  label?: string;
  labelHidden?: boolean;
  placeholder?: string;
  submitLabel?: string;
  acceptsImages?: boolean;
  acceptsDocuments?: readonly string[];
  controls?: ReactNode;
  /** A failure from a control in the toolbar, shown on the composer's error row. */
  error?: string;
  initialAttachments?: StagedAttachment[];
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const staged = useStagedAttachments(initialAttachments, {
    images: acceptsImages,
    documents: acceptsDocuments,
  });
  const { attachments } = staged;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paste an image straight into the composer. Plain-text (and other) pastes
  // carry no image files, so they fall through to the textarea's default — text
  // is meant to be typed, not turned into an attachment.
  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const images = pickedFilesFrom(event.clipboardData.files).filter(
      (picked) => picked.kind === "image",
    );
    if (images.length === 0) return;
    event.preventDefault();
    void staged.addFiles(images);
  };
  const onPickFiles: ChangeEventHandler<HTMLInputElement> = (event) => {
    void staged.addFiles(pickedFilesFrom(event.target.files));
    event.target.value = ""; // let the same file be picked again after removal
  };

  const empty = value.trim() === "" && attachments.length === 0;

  const submit = () => {
    if (busy || empty) return;
    const text = value.trim();
    // Attachments first, then the text, so the model reads them before the
    // question.
    const parts: UIMessage["parts"] = [
      ...attachmentParts(attachments),
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ];
    const sizeError = messagePartsError(parts);
    if (sizeError) {
      staged.setErrors([sizeError]);
      return;
    }
    if (onSubmit(parts) === false) return;
    staged.clear();
  };

  const frame = (
    <div className="border border-rule transition-colors duration-150 focus-within:border-accent">
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((attachment) => {
            const name = attachmentName(attachment);
            return (
              <StagedTile
                key={attachment.id}
                removeLabel={attachment.kind === "image" ? "Remove image" : `Remove ${name}`}
                onRemove={() => staged.remove(attachment.id)}
              >
                {attachment.kind === "image" ? (
                  <ImageThumb src={attachment.part.url} alt={name} />
                ) : (
                  <FileThumb filename={name} />
                )}
              </StagedTile>
            );
          })}
        </ul>
      ) : null}
      <Textarea
        bare
        id={fieldId}
        aria-label={labelHidden ? label : undefined}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxRows={14}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {/* Failures get a row of their own, above the toolbar, so a long
          message never pushes the controls about. */}
      {[...staged.errors, ...(error === undefined ? [] : [error])].map((message) => (
        <p
          key={message}
          role="alert"
          className="border-t border-rule px-2 py-2 font-mono text-status-failed text-xs"
        >
          {message}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-2 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={attachmentAccept({ images: acceptsImages, documents: acceptsDocuments })}
          multiple
          hidden
          onChange={onPickFiles}
        />
        <Button onClick={() => fileInputRef.current?.click()}>+ add file</Button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {controls}
          {onCancel ? (
            <Button variant="dismissive" onClick={onCancel}>
              cancel
            </Button>
          ) : null}
          {submitLabel !== undefined ? (
            <Button variant="primary" disabled={busy || empty} onClick={submit}>
              {submitLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (label !== undefined && !labelHidden) {
    return (
      <Field htmlFor={fieldId} label={label}>
        {frame}
      </Field>
    );
  }
  return frame;
}

// One staged attachment in the composer's row: its thumbnail with a remove
// control pinned to the corner.
function StagedTile({
  removeLabel,
  onRemove,
  children,
}: {
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <li className="relative">
      {children}
      <button
        type="button"
        onClick={onRemove}
        title={removeLabel}
        aria-label={removeLabel}
        className="-top-2 -right-2 absolute flex h-5 w-5 cursor-pointer items-center justify-center border border-rule bg-canvas font-mono text-ink-muted text-xs leading-none hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}
