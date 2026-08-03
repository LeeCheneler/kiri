import {
  type CSSProperties,
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { Field } from "./field.tsx";

/**
 * Multi-line text field — a styled wrapper over the native `<textarea>`,
 * controlled via `value` / `onChange`, which receives the current text. The
 * multi-line counterpart to `TextInput`, with the same field-lockup and
 * assistive-tech wiring (label associates via a generated or supplied `id`, the
 * help line becomes `aria-describedby`, `required` sets `aria-required`) plus a
 * `rows` hint for the resting height. By default it stays vertically resizable;
 * pass `maxRows` instead to make it auto-grow with its content — from `rows` up
 * to `maxRows`, then scrolling — with the grip removed and the height snapping
 * back when the value is cleared (e.g. after a chat message sends). Pass `label`
 * to render the lockup; omit it for the bare control. `onKeyDown` and `onPaste`
 * are forwarded for callers that need key/clipboard handling (e.g. a chat
 * composer's Enter-to-send and paste-an-image). It owns the control's chrome —
 * and, when labelled, the field rhythm — but no width or margin. Pass `bare`
 * when a wrapping surface owns the chrome (border, background, focus ring) and
 * the control should sit inside it flush — e.g. a composer frame with its own
 * toolbar; with no visible label, `aria-label` names the bare control for
 * assistive tech.
 */
export function Textarea({
  value,
  onChange,
  id,
  name,
  label,
  description,
  required = false,
  disabled = false,
  placeholder,
  rows = 3,
  maxRows,
  bare = false,
  "aria-label": ariaLabel,
  onKeyDown,
  onPaste,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  bare?: boolean;
  "aria-label"?: string;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const ref = useRef<HTMLTextAreaElement>(null);
  const autoGrow = maxRows !== undefined;

  // Auto-grow to fit the content: reset to the natural height so a deletion can
  // shrink it, then expand to the scroll height. `rows`/`maxRows` bound it via
  // the min/max heights below, and clearing the value (e.g. a sent chat message)
  // runs this too, snapping back to the resting height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every value change — the text is read off the DOM node, not the closure.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || !autoGrow) return;
    el.style.height = "auto";
    // `offsetHeight - clientHeight` is the border, which `scrollHeight` (content
    // + padding) omits — add it back so the border-box height fits without clip.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value, autoGrow]);

  // The bounds tie to the `rows`/`maxRows` line counts plus the control's own
  // padding (`py-2` → 1rem) and border (1px each side), since it's border-box;
  // `1lh` is one line of its line-height. Off auto-grow it just stays resizable.
  const sizing: CSSProperties = autoGrow
    ? {
        resize: "none",
        overflowY: "auto",
        minHeight: `calc(${rows} * 1lh + 1rem + 2px)`,
        maxHeight: `calc(${maxRows} * 1lh + 1rem + 2px)`,
      }
    : { resize: "vertical" };

  const control = (
    <textarea
      ref={ref}
      id={fieldId}
      name={name}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      style={sizing}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      aria-describedby={description ? `${fieldId}-description` : undefined}
      aria-required={required ? true : undefined}
      aria-label={label === undefined ? ariaLabel : undefined}
      className={
        bare
          ? "w-full bg-transparent px-3 py-2 font-mono text-sm text-ink outline-none disabled:cursor-not-allowed disabled:opacity-50"
          : "w-full border border-rule bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      }
    />
  );
  if (label === undefined) return control;
  return (
    <Field htmlFor={fieldId} label={label} description={description} required={required}>
      {control}
    </Field>
  );
}
