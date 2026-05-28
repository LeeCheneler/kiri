import { Code, CodeBlock } from "../components/design-system/content/code.tsx";
import { InlineLink } from "../components/design-system/content/inline-link.tsx";
import { List } from "../components/design-system/content/list.tsx";
import { Prose } from "../components/design-system/content/prose.tsx";
import { Card } from "../components/design-system/surfaces/card.tsx";

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
 * the presentational primitives in `components/design-system/`, each shown
 * with its variants and usage guidance so new UI composes from the same
 * parts rather than re-deriving them.
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
        <Prose>
          <p className="mt-4 text-lg text-ink-muted italic leading-[1.45]">
            The building blocks kiri's interface is composed from — foundation tokens and the
            presentational primitives in{" "}
            <code className="font-mono text-base text-ink-muted not-italic">
              components/design-system
            </code>
            , each shown with its variants and usage guidance. Reach for these first; a new pattern
            earns its place only when nothing here fits.
          </p>
        </Prose>
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
        <Prose>
          <p className="mt-3">
            Each typeface has one job.{" "}
            <span className="font-mono text-sm text-ink">JetBrains Mono</span> is the default and
            carries the machine layer; <span className="font-display italic">Fraunces</span> is
            opt-in via <code className="font-mono text-sm text-ink-muted">font-display</code> and
            carries the human reading voice. If a person reads it like a sentence, reach for
            Fraunces — otherwise leave it Mono.
          </p>
        </Prose>

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
        <Prose>
          <p className="mt-3">
            Size and voice track together: the small steps are the machine layer (Mono), the display
            steps are the reading voice (Fraunces). Never set type below{" "}
            <span className="font-mono text-sm text-ink-muted">12px</span> — text-xs is the floor.
          </p>
        </Prose>
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

      <section aria-labelledby="surfaces">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="surfaces" className="font-display text-3xl text-ink leading-tight">
            Surfaces
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">components/design-system/surfaces</p>
        </header>

        <article>
          <h4 className="font-mono text-base text-ink">Card</h4>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            <span className="text-ink-muted">Card</span> ·
            components/design-system/surfaces/card.tsx
          </p>
          <Prose>
            <p className="mt-3">
              A bordered surface that lifts a block of related content off the page background with
              a hairline rule and even padding. Use it to group a self-contained unit — a demo, a
              stat panel, a callout. It owns its frame and padding only; the space around it is the
              caller's layout concern.
            </p>
          </Prose>
          <div className="mt-5">
            <Card>
              <Prose>
                <p>Content sits inside the card, framed by a hairline rule and even padding.</p>
              </Prose>
            </Card>
          </div>
        </article>
      </section>

      <section aria-labelledby="content">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="content" className="font-display text-3xl text-ink leading-tight">
            Content
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">components/design-system/content</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Prose</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Prose</span> ·
              components/design-system/content/prose.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Reading content — a guideline, an article, a rendered summary — goes inside the{" "}
                <code className="font-mono text-sm text-ink-muted">Prose</code> container. It owns
                the reading measure (about 65 characters wide) and the base reading voice, so line
                length stays comfortable and consistent across surfaces. Never put a max-width on
                text by hand — reach for Prose and let it own the width.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <p>
                    This paragraph sits inside Prose, so it wraps at the reading measure no matter
                    how wide the surrounding column grows. The line breaks where the eye wants a
                    rest rather than running the full width of the page, which is the whole point —
                    measure is a property of the container, never a number sprinkled onto the text.
                  </p>
                </Prose>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Inline link</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">InlineLink</span> ·
              components/design-system/content/inline-link.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A link inside a run of prose or chrome. It is accent-coloured and underlined so it
                reads as a link before any hover. Internal routes navigate client-side; pass{" "}
                <code className="font-mono text-sm text-ink-muted">external</code> for outbound
                URLs, which open in a new tab. Reach for this for any in-flow link — standalone
                navigation (the side rail, a back link) has its own treatment.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <p>
                    The morning digest pulls highlights from{" "}
                    <InlineLink href="/workflows/daily">the daily workflow</InlineLink> and cites{" "}
                    <InlineLink href="https://example.com" external>
                      an external source
                    </InlineLink>{" "}
                    when the summary quotes one.
                  </p>
                </Prose>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Code</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Code</span> ·{" "}
              <span className="text-ink-muted">CodeBlock</span> ·
              components/design-system/content/code.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Code is the machine layer, always set in mono. <Code>Code</Code> is the inline token
                — a chip for a snippet, filename, or literal value inside prose.{" "}
                <Code>CodeBlock</Code> is the multi-line panel: it preserves whitespace and scrolls
                long lines rather than wrapping them.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <p>
                    Reference a token like <Code>--color-accent</Code> or a path like{" "}
                    <Code>components/design-system</Code> inline, then drop to a block for a full
                    snippet:
                  </p>
                </Prose>
                <div className="mt-4">
                  <CodeBlock>{`export function Card({ children }) {
  return (
    <div className="rounded-sm border border-rule bg-canvas-2 p-6">
      {children}
    </div>
  );
}`}</CodeBlock>
                </div>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Lists</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">List</span> ·
              components/design-system/content/list.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A reading-content list, set in the reading voice with markers in muted ink. Bulleted
                by default; pass <Code>ordered</Code> for a numbered list — use it only when
                sequence actually matters. Children are the list items; the list inherits its voice
                from the surrounding Prose.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <List>
                    <li>Each step runs in order, top to bottom.</li>
                    <li>A step's output flows to the next as input.</li>
                    <li>The first failure halts the run.</li>
                  </List>
                  <div className="mt-4">
                    <List ordered>
                      <li>Load the workflow definition.</li>
                      <li>Resolve inputs and run each step.</li>
                      <li>Summarise and publish the result.</li>
                    </List>
                  </div>
                </Prose>
              </Card>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
