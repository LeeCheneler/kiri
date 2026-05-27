import type { ReactNode } from "react";

type Tone = "muted" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  muted: "text-ink-muted hover:text-ink focus-visible:text-ink",
  accent: "text-accent hover:text-ink",
};

/**
 * Borderless inline action button — modal cancel/submit, disclosure
 * toggles, anywhere an action sits inside chrome that already supplies
 * its own visual weight (dialog frame, expanded panel) and shouldn't
 * carry a border of its own. Positioning and error placement belong to
 * the surrounding `<Actions>` group.
 *
 * `pending` swaps the label for a pulsing dot + `pendingLabel` and
 * implicitly disables the button. `tone` drives colour only — `muted`
 * for dismissive actions, `accent` for primary actions inside a frame.
 */
export function TextButton({
  children,
  tone = "muted",
  pending = false,
  pendingLabel,
  disabled = false,
  type = "button",
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
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
      data-tone={tone}
      className={`cursor-pointer font-mono text-xs transition-colors duration-150 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:text-ink-muted ${TONE_CLASSES[tone]}`}
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
