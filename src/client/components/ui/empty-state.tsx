/**
 * Italic Fraunces paragraph for "nothing here yet" prose. Takes
 * `children` rather than a `message` prop so callers can embed inline
 * elements — e.g. the workflows nav's empty state interleaves `<code>`
 * chunks pointing at `kiri init` and `workflows/`.
 */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-base text-ink-muted italic">{children}</p>;
}
