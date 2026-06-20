import type { UIMessage } from "ai";
import {
  type ChangeEventHandler,
  type ClipboardEventHandler,
  useCallback,
  useRef,
  useState,
} from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import { type PendingImage, imageFilesFrom, readPendingImages } from "./attachments.ts";
import { ImageThumb } from "./image-thumb.tsx";

/**
 * The shared message composer: a full-width auto-growing textarea with image
 * attachments (staged from the file picker or a paste), Enter to submit and
 * Shift+Enter for a newline. Text is controlled via `value`/`onChange`, so the
 * caller owns persistence; staged images are internal and cleared on submit.
 * `onSubmit` receives the assembled `UIMessage` parts — images first, then the
 * text — and the caller decides what they mean (send a turn, resend an edit).
 * Disabled while `busy`. Pass `id` to let the caller focus the field.
 */
export function MessageComposer({
  value,
  onChange,
  onSubmit,
  busy = false,
  id,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (parts: UIMessage["parts"]) => void;
  busy?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
}) {
  const [attachments, setAttachments] = useState<PendingImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const { images, error } = await readPendingImages(files);
    if (images.length > 0) setAttachments((prev) => [...prev, ...images]);
    setAttachmentError(error);
  }, []);
  // Paste an image straight into the composer. Plain-text (and other) pastes
  // carry no image files, so they fall through to the textarea's default.
  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const files = imageFilesFrom(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };
  const onPickFiles: ChangeEventHandler<HTMLInputElement> = (event) => {
    void addImageFiles(imageFilesFrom(event.target.files));
    event.target.value = ""; // let the same file be picked again after removal
  };
  const removeAttachment = (imageId: string) =>
    setAttachments((prev) => prev.filter((image) => image.id !== imageId));

  const submit = () => {
    if (busy) return;
    const text = value.trim();
    if (text === "" && attachments.length === 0) return;
    // Images first, then the text, so the model reads the picture before the
    // question (and a single image needs no naming to be referenced).
    const parts: UIMessage["parts"] = [
      ...attachments.map((image) => image.part),
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ];
    onSubmit(parts);
    setAttachments([]);
    setAttachmentError(undefined);
  };

  return (
    <div>
      {attachments.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {attachments.map((image) => (
            <li key={image.id} className="relative">
              <ImageThumb src={image.part.url} alt={image.part.filename ?? "Attached image"} />
              <button
                type="button"
                onClick={() => removeAttachment(image.id)}
                disabled={busy}
                title="Remove image"
                aria-label="Remove image"
                className="-top-2 -right-2 absolute flex h-5 w-5 items-center justify-center border border-rule bg-canvas font-mono text-ink-muted text-xs leading-none hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
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
        disabled={busy}
        maxRows={14}
        onPaste={onPaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPickFiles}
        />
        <Button variant="dismissive" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          add image
        </Button>
        {attachmentError ? (
          <span role="alert" className="font-mono text-status-failed text-xs">
            {attachmentError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
