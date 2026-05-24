/**
 * Bottom-ruled section header used across the run and workflow detail
 * pages. Renders the title in small-caps mono on the left; the optional
 * `count` string (pre-formatted by the caller — pluralisation belongs
 * to whoever owns the words) on the right in mono small-caps.
 *
 * `headingId` threads onto the underlying `<h3 id>` so a sibling list
 * can pair with the header via `aria-labelledby`.
 */
export function SectionHeader({
  title,
  count,
  headingId,
}: {
  title: string;
  count?: string;
  headingId?: string;
}) {
  return (
    <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
      <h3 id={headingId} className="text-xs tracking-widest text-ink-muted uppercase">
        {title}
      </h3>
      {count !== undefined && (
        <span className="font-mono text-xs text-ink-muted tabular-nums">{count}</span>
      )}
    </header>
  );
}
