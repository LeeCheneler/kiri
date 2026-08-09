import type { ReactNode } from "react";

type Variant = "primary" | "default" | "negative" | "negative-quiet" | "dismissive";
type Size = "sm" | "lg";

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
 * carries its own visual weight. `size` bumps padding and label — `lg` for a
 * headline action, `sm` (default) everywhere else.
 *
 * `pending` swaps the label for a pulsing dot + `pendingLabel` and implicitly
 * disables the button. It owns its intrinsic style and padding only;
 * positioning and any shared error slot belong to the surrounding action group.
 * A button that toggles an attached surface (a popover, a disclosure) passes
 * `aria-expanded` / `aria-haspopup` through so assistive tech hears the state.
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
  title?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: boolean | "dialog" | "listbox" | "menu";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
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
