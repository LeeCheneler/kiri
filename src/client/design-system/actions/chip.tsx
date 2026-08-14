import type { ReactNode } from "react";

/**
 * A pill-shaped one-shot action — a plain button in the chip form, for a
 * compact tappable suggestion that acts immediately (a suggested reply, a
 * ready-made refinement). It fires `onClick` and holds no on/off state — for
 * a toggle rendered as a chip use `ToggleChip`, and for a standalone action
 * with button weight use `Button`. `disabled` dims and blocks it. It owns its
 * own chrome but no surrounding margin — lay several out in a
 * `flex flex-wrap` for a chip row.
 */
export function Chip({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex cursor-pointer items-center rounded-full border border-rule px-3 py-1 font-mono text-xs text-ink outline-none transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-rule disabled:hover:text-ink"
    >
      {children}
    </button>
  );
}
