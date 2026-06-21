import type { UIMessage } from "ai";
import {
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import {
  ATTACHMENT_ACCEPT,
  type PendingImage,
  type PendingTextFile,
  imageFilesFrom,
  readPendingImages,
  readPendingTextFiles,
  textFilesFrom,
  wrapAttachedFile,
} from "./attachments.ts";
import { FileThumb } from "./file-thumb.tsx";
import { ImageThumb } from "./image-thumb.tsx";

/**
 * The shared message composer: a full-width auto-growing textarea with image
 * and text-file attachments (staged from the file picker, images also from a
 * paste), Enter to submit and Shift+Enter for a newline. Text is controlled via
 * `value`/`onChange`, so the caller owns persistence; staged attachments start
 * from `initialImages`/`initialTextFiles` and are cleared on submit. `onSubmit`
 * receives the assembled `UIMessage` parts — images, then each text file as an
 * `<attached-file>` text part, then the typed text — and the caller decides what
 * they mean (send a turn, resend an edit). `onCancel`, when given, fires on
 * Escape (e.g. to close an inline editor). While `busy` — a turn is in flight —
 * the field and its controls stay editable so the next message can be drafted,
 * but submitting is blocked until the turn settles. Pass `id` to let the caller
 * focus the field, `label` for the field lockup, and `hint` for a trailing
 * key-hint line.
 */
export function MessageComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy = false,
  id,
  label,
  placeholder,
  hint,
  initialImages = [],
  initialTextFiles = [],
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (parts: UIMessage["parts"]) => void;
  onCancel?: () => void;
  busy?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
  hint?: ReactNode;
  initialImages?: PendingImage[];
  initialTextFiles?: PendingTextFile[];
}) {
  const [images, setImages] = useState<PendingImage[]>(initialImages);
  const [textFiles, setTextFiles] = useState<PendingTextFile[]>(initialTextFiles);
  const [attachmentError, setAttachmentError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const { images, error } = await readPendingImages(files);
    if (images.length > 0) setImages((prev) => [...prev, ...images]);
    setAttachmentError(error);
  }, []);
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

  const submit = () => {
    if (busy) return;
    const text = value.trim();
    if (text === "" && images.length === 0 && textFiles.length === 0) return;
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
    onSubmit(parts);
    setImages([]);
    setTextFiles([]);
    setAttachmentError(undefined);
  };

  return (
    <div>
      {images.length > 0 || textFiles.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2">
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
        id={id}
        label={label}
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
      <div className="mt-2 flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          onChange={onPickFiles}
        />
        <Button variant="dismissive" onClick={() => fileInputRef.current?.click()}>
          add file
        </Button>
        {attachmentError ? (
          <span role="alert" className="font-mono text-status-failed text-xs">
            {attachmentError}
          </span>
        ) : null}
        {hint ? <span className="ml-auto font-mono text-ink-muted text-xs">{hint}</span> : null}
      </div>
    </div>
  );
}
