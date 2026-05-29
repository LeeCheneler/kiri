import type { ReactNode } from "react";

/**
 * Bordered surface panel. Lifts a block of related content off the page
 * background with a hairline rule and even inset padding — the default
 * container for grouping a self-contained unit (a demo, a stat panel, a
 * callout). It owns its frame and padding only; spacing between the card
 * and its surroundings is the caller's layout concern.
 */
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-sm border border-rule bg-canvas-2 p-6">{children}</div>;
}
