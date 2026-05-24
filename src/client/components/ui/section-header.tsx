/**
 * Bottom-ruled section header used across the run and workflow detail
 * pages. Renders the title in small-caps mono on the left; the optional
 * `meta` string on the right in mono small-caps — typically a count or
 * other small secondary fact about the section.
 *
 * `headingId` threads onto the underlying `<h3 id>` so a sibling list
 * can pair with the header via `aria-labelledby`.
 */
export function SectionHeader({
  title,
  meta,
  headingId,
}: {
  title: string;
  meta?: string;
  headingId?: string;
}) {
  return (
    <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
      <h3 id={headingId} className="text-xs tracking-widest text-ink-muted uppercase">
        {title}
      </h3>
      {meta !== undefined && (
        <span className="font-mono text-xs text-ink-muted tabular-nums">{meta}</span>
      )}
    </header>
  );
}
