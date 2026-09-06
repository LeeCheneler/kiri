import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

type Variant = "primary" | "default" | "negative" | "negative-quiet" | "dismissive";
type Size = "inline" | "sm" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "border border-accent bg-accent text-canvas hover:bg-transparent hover:text-accent focus-visible:bg-transparent focus-visible:text-accent",
  default:
    "border border-ink text-ink hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent",
  negative:
    "border border-status-failed bg-status-failed text-canvas hover:bg-transparent hover:text-status-failed focus-visible:bg-transparent focus-visible:text-status-failed",
  // Muted at rest, only turning red on approach — destructive intent shows
  // when the pointer arrives, not before.
  "negative-quiet":
    "border border-transparent text-ink-muted hover:text-status-failed focus-visible:text-status-failed",
  // Transparent border so the box matches the bordered variants and stays
  // aligned when they share a row.
  dismissive: "border border-transparent text-ink-muted hover:text-ink focus-visible:text-ink",
};

const SIZE_CLASSES: Record<Size, string> = {
  // No padding, so the label sits flush in a text row and the row's own
  // separators (a Meta middot, say) space evenly either side of it.
  inline: "text-xs",
  sm: "px-3 py-1.5 text-xs",
  lg: "px-5 py-2.5 text-sm",
};

/**
 * The action button. `variant` carries the emphasis: `primary` is the
 * solid-accent affirmative call-to-action (one per surface), `default` is
 * the outlined everyday action, `negative` is the solid destructive action,
 * `negative-quiet` is its low-weight sibling for a destructive action that
 * shouldn't dominate its surface (still confirm before acting on it), and
 * `dismissive` is a borderless low-weight action for chrome that already
 * carries its own visual weight. `size` sets the padding — `lg` for a headline
 * action, `inline` for a borderless action seated in a run of text, and `sm`
 * (default) everywhere else.
 *
 * `pending` swaps the label for a pulsing dot + `pendingLabel` and implicitly
 * disables the button. It owns its intrinsic style and padding only;
 * positioning and any shared error slot belong to the surrounding action group.
 * A button that toggles an attached surface (a popover, a disclosure) passes
 * `aria-expanded` / `aria-haspopup` through so assistive tech hears the state.
 *
 * A hold action (push-to-talk) takes `onPressStart` / `onPressEnd` instead of
 * `onClick`: the pair fires on pointer down / up (the pointer is captured, so
 * a release outside the button still ends the hold) and on Space or Enter
 * down / up from the keyboard.
 */
export function Button({
  children,
  variant = "default",
  size = "sm",
  pending = false,
  pendingLabel,
  disabled = false,
  type = "button",
  onClick,
  onPressStart,
  onPressEnd,
  title,
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHasPopup,
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
  title?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: boolean | "dialog" | "listbox" | "menu";
}) {
  const hold = onPressStart !== undefined || onPressEnd !== undefined;
  const onPointerDown = hold
    ? (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onPressStart?.();
      }
    : undefined;
  const onPressKey = (event: KeyboardEvent<HTMLButtonElement>): boolean => {
    if (event.key !== " " && event.key !== "Enter") return false;
    // Not the browser's own click for these keys — the hold owns them.
    event.preventDefault();
    return true;
  };
  const onKeyDown = hold
    ? (event: KeyboardEvent<HTMLButtonElement>) => {
        if (onPressKey(event) && !event.repeat) onPressStart?.();
      }
    : undefined;
  const onKeyUp = hold
    ? (event: KeyboardEvent<HTMLButtonElement>) => {
        if (onPressKey(event)) onPressEnd?.();
      }
    : undefined;
  return (
    <button
      type={type}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={hold ? onPressEnd : undefined}
      onPointerCancel={hold ? onPressEnd : undefined}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      disabled={disabled || pending}
      title={title}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      data-variant={variant}
      className={`cursor-pointer whitespace-nowrap font-mono outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}`}
    >
      {pending ? (
        <span className="inline-flex items-baseline gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
          />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
