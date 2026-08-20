import type { UIMessage } from "ai";
import {
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ReactNode,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Field } from "../../design-system/actions/field.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import {
  ATTACHMENT_ACCEPT,
  type PendingImage,
  type PendingTextFile,
  TEXT_ATTACHMENT_ACCEPT,
  imageFilesFrom,
  readPendingImages,
  readPendingTextFiles,
  textFilesFrom,
  wrapAttachedFile,
} from "./attachments.ts";
import { FileThumb } from "./file-thumb.tsx";
import { ImageThumb } from "./image-thumb.tsx";

/**
 * The shared message composer: one framed surface holding any staged
 * attachments, an auto-growing textarea, and a toolbar — add file on the left;
 * caller controls, an optional cancel, and an optional submit button on the
 * right. Images and text files stage from the file picker (images also from a
 * paste), Enter submits and Shift+Enter breaks a line. Text is controlled via
 * `value`/`onChange`, so the caller owns persistence; staged attachments start
 * from `initialImages`/`initialTextFiles` and are cleared on submit. `onSubmit`
 * receives the assembled `UIMessage` parts — images, then each text file as an
 * `<attached-file>` text part, then the typed text — and the caller decides what
 * they mean (send a turn, resend an edit); returning `false` refuses the
 * submit — staged attachments stay put for the caller's error to explain.
 * `onCancel`, when given, fires from
 * Escape and a cancel button in the toolbar (e.g. to close an inline editor).
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
 */
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
  controls,
  initialImages = [],
  initialTextFiles = [],
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
  controls?: ReactNode;
  initialImages?: PendingImage[];
  initialTextFiles?: PendingTextFile[];
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [images, setImages] = useState<PendingImage[]>(initialImages);
  const [textFiles, setTextFiles] = useState<PendingTextFile[]>(initialTextFiles);
  const [attachmentError, setAttachmentError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // The single gate for images from any route (picker or paste): a
      // text-only model surfaces why instead of staging a doomed attachment.
      if (!acceptsImages) {
        setAttachmentError("This model reads text only. Switch model to attach images.");
        return;
      }
      const { images, error } = await readPendingImages(files);
      if (images.length > 0) setImages((prev) => [...prev, ...images]);
      setAttachmentError(error);
    },
    [acceptsImages],
  );
  const addTextFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const { textFiles, error } = await readPendingTextFiles(files);
    if (textFiles.length > 0) setTextFiles((prev) => [...prev, ...textFiles]);
    setAttachmentError(error);
  }, []);
  // Paste an image straight into the composer. Plain-text (and other) pastes
  // carry no image files, so they fall through to the textarea's default — text
  // is meant to be typed, not turned into an attachment.
  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const files = imageFilesFrom(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };
  const onPickFiles: ChangeEventHandler<HTMLInputElement> = (event) => {
    void addImageFiles(imageFilesFrom(event.target.files));
    void addTextFiles(textFilesFrom(event.target.files));
    event.target.value = ""; // let the same file be picked again after removal
  };
  const removeImage = (id: string) => setImages((prev) => prev.filter((image) => image.id !== id));
  const removeTextFile = (id: string) =>
    setTextFiles((prev) => prev.filter((file) => file.id !== id));

  const empty = value.trim() === "" && images.length === 0 && textFiles.length === 0;

  const submit = () => {
    if (busy || empty) return;
    const text = value.trim();
    // Attachments first, then the text, so the model reads them before the
    // question. Text files ride as `<attached-file>` text parts, which reach
    // every provider as plain text.
    const parts: UIMessage["parts"] = [
      ...images.map((image) => image.part),
      ...textFiles.map((file) => ({
        type: "text" as const,
        text: wrapAttachedFile(file.filename, file.content),
      })),
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ];
    if (onSubmit(parts) === false) return;
    setImages([]);
    setTextFiles([]);
    setAttachmentError(undefined);
  };

  const frame = (
    <div className="border border-rule transition-colors duration-150 focus-within:border-accent">
      {images.length > 0 || textFiles.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pt-3">
          {images.map((image) => (
            <li key={image.id} className="relative">
              <ImageThumb src={image.part.url} alt={image.part.filename ?? "Attached image"} />
              <button
                type="button"
                onClick={() => removeImage(image.id)}
                title="Remove image"
                aria-label="Remove image"
                className="-top-2 -right-2 absolute flex h-5 w-5 cursor-pointer items-center justify-center border border-rule bg-canvas font-mono text-ink-muted text-xs leading-none hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
          {textFiles.map((file) => (
            <li key={file.id} className="relative">
              <FileThumb filename={file.filename} />
              <button
                type="button"
                onClick={() => removeTextFile(file.id)}
                title={`Remove ${file.filename}`}
                aria-label={`Remove ${file.filename}`}
                className="-top-2 -right-2 absolute flex h-5 w-5 cursor-pointer items-center justify-center border border-rule bg-canvas font-mono text-ink-muted text-xs leading-none hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
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
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-2 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptsImages ? ATTACHMENT_ACCEPT : TEXT_ATTACHMENT_ACCEPT}
          multiple
          hidden
          onChange={onPickFiles}
        />
        <Button onClick={() => fileInputRef.current?.click()}>+ add file</Button>
        {attachmentError ? (
          <span role="alert" className="font-mono text-status-failed text-xs">
            {attachmentError}
          </span>
        ) : null}
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
