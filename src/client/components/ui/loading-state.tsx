/**
 * Italic Fraunces paragraph for "loading…" prose. Renders as `<output>`
 * — implicit `role="status"` — so screen readers announce the
 * transition; otherwise visually identical to `<EmptyState>`.
 */
export function LoadingState({ children }: { children: React.ReactNode }) {
  return <output className="block font-display text-base text-ink-muted italic">{children}</output>;
}
