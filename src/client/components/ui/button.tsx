import type { ReactNode } from "react";

type Variant = "primary" | "danger" | "solid";
type Size = "sm" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "border-rule text-ink hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent",
  danger:
    "border-rule text-ink hover:border-status-failed hover:text-status-failed focus-visible:border-status-failed focus-visible:text-status-failed",
  solid:
    "border-accent bg-accent text-canvas hover:bg-transparent hover:text-accent focus-visible:bg-transparent focus-visible:text-accent",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  lg: "px-5 py-2.5 text-sm",
};

/**
 * Bordered action button for page-level actions (copy, cancel-run,
 * delete, run-again, trigger). Positioning and error placement belong
 * to the surrounding `<Actions>` group — this component renders the
 * button and nothing else.
 *
 * `pending` swaps the label for a pulsing dot + `pendingLabel` and
 * implicitly disables the button. `variant` drives the colour treatment:
 * `primary` and `danger` are ghost buttons that tint to accent /
 * status-failed on hover; `solid` is a filled accent call-to-action that
 * inverts to a ghost on hover. `size` bumps padding and label size —
 * `lg` for a headline action, `sm` (default) everywhere else.
 */
export function Button({
  children,
  variant = "primary",
  size = "sm",
  pending = false,
  pendingLabel,
  disabled = false,
  type = "button",
  onClick,
  title,
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
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      title={title}
      data-variant={variant}
      className={`cursor-pointer border font-mono no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}`}
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
