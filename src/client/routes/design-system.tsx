// Display sizes climb with the reading voice; the small steps are the
// machine layer. Each carries the literal Tailwind class so the size is
// generated and the specimen renders true to life.
const TYPE_SCALE = [
  {
    cls: "text-7xl",
    px: "72px",
    font: "font-display italic",
    sample: "The morning briefing",
    role: "Article hero title",
  },
  {
    cls: "text-6xl",
    px: "60px",
    font: "font-display italic",
    sample: "The morning briefing",
    role: "Workflow hero title",
  },
  {
    cls: "text-5xl",
    px: "48px",
    font: "font-display italic",
    sample: "The morning briefing",
    role: "Reference & secondary hero",
  },
  {
    cls: "text-4xl",
    px: "36px",
    font: "font-display",
    sample: "The morning briefing",
    role: "Primary page & section headings",
  },
  {
    cls: "text-3xl",
    px: "30px",
    font: "font-display",
    sample: "The morning briefing",
    role: "Prose headings",
  },
  {
    cls: "text-2xl",
    px: "24px",
    font: "font-display",
    sample: "The morning briefing",
    role: "Sub-headings & stat figures",
  },
  {
    cls: "text-lg",
    px: "18px",
    font: "font-display italic",
    sample: "An editorial aside in the reading voice",
    role: "Lede & descriptions",
  },
  {
    cls: "text-base",
    px: "16px",
    font: "",
    sample: "Body default — ran 12 workflows",
    role: "Body / html base",
  },
  {
    cls: "text-sm",
    px: "14px",
    font: "",
    sample: "Secondary chrome · 1.2s · ok",
    role: "Secondary chrome, large buttons",
  },
  {
    cls: "text-xs",
    px: "12px",
    font: "",
    sample: "labels · meta · status",
    role: "Eyebrows, labels, small buttons — the floor",
  },
];

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

      <section aria-labelledby="foundations">
        <header className="mt-12 mb-6 border-b border-rule pb-3">
          <h3 id="foundations" className="font-display text-3xl text-ink leading-tight">
            Foundations
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            design tokens · src/client/app.css
          </p>
        </header>

        <h4 className="text-xs tracking-widest text-ink-muted uppercase">Typefaces</h4>
        <p className="mt-3 max-w-[64ch] font-display text-base text-ink leading-relaxed">
          Each typeface has one job.{" "}
          <span className="font-mono text-sm text-ink">JetBrains Mono</span> is the default and
          carries the machine layer; <span className="font-display italic">Fraunces</span> is opt-in
          via <code className="font-mono text-sm text-ink-muted">font-display</code> and carries the
          human reading voice. If a person reads it like a sentence, reach for Fraunces — otherwise
          leave it Mono.
        </p>

        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div>
            <p className="font-display text-4xl text-ink italic leading-none">Fraunces</p>
            <p className="mt-3 font-mono text-xs tracking-widest text-ink-muted uppercase">
              font-display · reading voice
            </p>
            <ul className="mt-3 space-y-1 font-mono text-sm text-ink-muted">
              <li>Page &amp; section titles</li>
              <li>Article prose — body, lists, blockquote</li>
              <li>Editorial descriptions (italic, muted)</li>
            </ul>
          </div>
          <div>
            <p className="text-4xl text-ink leading-none">JetBrains Mono</p>
            <p className="mt-3 font-mono text-xs tracking-widest text-ink-muted uppercase">
              font-mono · machine layer · default
            </p>
            <ul className="mt-3 space-y-1 font-mono text-sm text-ink-muted">
              <li>UI chrome, labels &amp; eyebrows</li>
              <li>Buttons, controls &amp; navigation</li>
              <li>Data, numbers &amp; code</li>
            </ul>
          </div>
        </div>

        <h4 className="mt-12 text-xs tracking-widest text-ink-muted uppercase">Type scale</h4>
        <p className="mt-3 max-w-[64ch] font-display text-base text-ink leading-relaxed">
          Size and voice track together: the small steps are the machine layer (Mono), the display
          steps are the reading voice (Fraunces). Never set type below{" "}
          <span className="font-mono text-sm text-ink-muted">12px</span> — text-xs is the floor.
        </p>
        <ul className="mt-6">
          {TYPE_SCALE.map((step) => (
            <li
              key={step.cls}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule py-4 last:border-0"
            >
              <span className={`${step.font} ${step.cls} text-ink leading-tight`}>
                {step.sample}
              </span>
              <span className="shrink-0 font-mono text-xs text-ink-muted">
                <span className="text-ink">{step.cls}</span> · {step.px} · {step.role}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
