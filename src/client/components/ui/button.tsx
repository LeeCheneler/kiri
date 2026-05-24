import type { ReactNode } from "react";

type Variant = "primary" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent",
  danger:
    "hover:border-status-failed hover:text-status-failed focus-visible:border-status-failed focus-visible:text-status-failed",
};

/**
 * Bordered action button for page-level actions (copy, cancel-run,
 * delete, run-again, trigger). Positioning and error placement belong
 * to the surrounding `<Actions>` group — this component renders the
 * button and nothing else.
 *
 * `pending` swaps the label for a pulsing dot + `pendingLabel` and
 * implicitly disables the button. `variant` drives hover/focus only —
 * `primary` tints to accent, `danger` to status-failed.
 */
export function Button({
  children,
  variant = "primary",
  pending = false,
  pendingLabel,
  disabled = false,
  type = "button",
  onClick,
  title,
}: {
  children: ReactNode;
  variant?: Variant;
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
      className={`cursor-pointer border border-rule px-3 py-1.5 font-mono text-xs tracking-widest text-ink uppercase no-underline outline-none transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]}`}
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
