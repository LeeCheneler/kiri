/**
 * Dev-only living design system. The single source of truth for kiri's
 * UI building blocks: the foundation tokens (colour, type, status) and
 * the presentational primitives in `components/ui/`, each shown with its
 * variants and usage guidance so new UI composes from the same parts
 * rather than re-deriving them.
 *
 * Pure composition — no data, no state. Sections fill in as primitives
 * are catalogued.
 */
export function DesignSystem() {
  return (
    <section>
      <header className="border-b border-rule pb-6">
        <p className="text-xs tracking-widest text-ink-muted uppercase">Dev</p>
        <h2 className="mt-2 font-display text-5xl text-ink italic leading-[0.95] tracking-tight">
          Design System
        </h2>
        <p className="mt-4 max-w-[60ch] font-display text-lg text-ink-muted italic leading-[1.45]">
          The building blocks kiri's interface is composed from — foundation tokens and the
          presentational primitives in{" "}
          <code className="font-mono text-base text-ink-muted not-italic">components/ui</code>, each
          shown with its variants and usage guidance. Reach for these first; a new pattern earns its
          place only when nothing here fits.
        </p>
      </header>
      <p className="mt-8 font-mono text-sm text-ink-faint">
        Catalogue under construction — sections land as primitives are captured.
      </p>
    </section>
  );
}
