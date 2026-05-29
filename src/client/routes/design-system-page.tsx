import { useState } from "react";
import { Button } from "../design-system/actions/button.tsx";
import { Select } from "../design-system/actions/select.tsx";
import { Sparkline, type SparklineBar } from "../design-system/charts/sparkline.tsx";
import { Code, CodeBlock } from "../design-system/content/code.tsx";
import { Disclosure } from "../design-system/content/disclosure.tsx";
import { EmptyState } from "../design-system/content/empty-state.tsx";
import { InlineLink } from "../design-system/content/inline-link.tsx";
import { List } from "../design-system/content/list.tsx";
import { Markdown } from "../design-system/content/markdown.tsx";
import { Meta } from "../design-system/content/meta.tsx";
import { Prose } from "../design-system/content/prose.tsx";
import { Quote } from "../design-system/content/quote.tsx";
import { Rule } from "../design-system/content/rule.tsx";
import { Stat, StatList } from "../design-system/content/stat.tsx";
import { Table } from "../design-system/content/table.tsx";
import { StatusBlock } from "../design-system/feedback/status-block.tsx";
import { Status, type StatusKind } from "../design-system/feedback/status.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { NavList } from "../design-system/navigation/nav-list.tsx";
import { Tabs } from "../design-system/navigation/tabs.tsx";
import { Toc, type TocEntry } from "../design-system/navigation/toc.tsx";
import { Card } from "../design-system/surfaces/card.tsx";
import { Modal } from "../design-system/surfaces/modal.tsx";

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
    role: "Sub-headings & titles",
  },
  {
    cls: "text-xl",
    px: "20px",
    font: "font-display",
    sample: "The morning briefing",
    role: "Markdown h3 & minor headings",
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

// Interactive specimen for the Select control, which owns its controlled value.
function SelectDemo() {
  const [cadence, setCadence] = useState("daily");
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="ds-select-cadence"
        className="font-mono text-xs tracking-widest text-ink-muted uppercase"
      >
        Cadence
      </label>
      <Select id="ds-select-cadence" value={cadence} onChange={setCadence}>
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
        <option value="monthly">monthly</option>
      </Select>
    </div>
  );
}

// Interactive specimen for the Modal — a button opens a confirm dialog.
function ModalDemo() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>open dialog</Button>
      {open && (
        <Modal title="Discard draft?" onClose={close}>
          <Prose>
            <p>This can't be undone — the draft and its unsaved edits will be cleared.</p>
          </Prose>
          <div className="mt-6 flex justify-end gap-4">
            <Button variant="dismissive" onClick={close}>
              cancel
            </Button>
            <Button variant="negative" onClick={close}>
              discard
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** This page's own sections, in document order — drives the right-rail TOC. */
const TOC_ENTRIES: TocEntry[] = [
  { id: "foundations", label: "Foundations" },
  { id: "surfaces", label: "Surfaces" },
  { id: "content", label: "Content" },
  { id: "actions", label: "Actions" },
  { id: "navigation", label: "Navigation" },
  { id: "charts", label: "Charts" },
  { id: "feedback", label: "Feedback" },
];

const STATUSES: StatusKind[] = ["pending", "running", "ok", "failed", "cancelled", "interrupted"];

// A fortnight of made-up run durations (ms), oldest → newest, for the Sparkline
// specimen: a mostly-healthy run of work with two slower spikes and one failure.
const SPARKLINE_BARS: SparklineBar[] = [
  { value: 820, tone: "ok", label: "0.82s" },
  { value: 910, tone: "ok", label: "0.91s" },
  { value: 760, tone: "ok", label: "0.76s" },
  { value: 1480, tone: "warm", label: "1.48s" },
  { value: 880, tone: "ok", label: "0.88s" },
  { value: 0, tone: "failed", label: "failed" },
  { value: 840, tone: "ok", label: "0.84s" },
  { value: 1290, tone: "warm", label: "1.29s" },
  { value: 800, tone: "ok", label: "0.80s" },
  { value: 870, tone: "ok", label: "0.87s" },
  { value: 1610, tone: "warm", label: "1.61s" },
  { value: 790, tone: "ok", label: "0.79s" },
  { value: 850, tone: "ok", label: "0.85s" },
  { value: 910, tone: "ok", label: "0.91s" },
];

/** Right-rail table of contents for the design-system page. */
export function DesignSystemAside() {
  return <Toc heading="On this page" entries={TOC_ENTRIES} />;
}

/**
 * Dev-only living design system. The single source of truth for kiri's
 * UI building blocks: the foundation tokens (colour, type, status) and
 * the presentational primitives in `design-system/`, each shown
 * with its variants and usage guidance so new UI composes from the same
 * parts rather than re-deriving them.
 *
 * No fetched data; interactive controls hold their own local demo state.
 * Sections fill in as primitives are catalogued.
 */
export function DesignSystemPage() {
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
            presentational primitives in <Code>design-system</Code>, each shown with its variants
            and usage guidance. Reach for these first; a new pattern earns its place only when
            nothing here fits.
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
            opt-in via <Code>font-display</Code> and carries the human reading voice. If a person
            reads it like a sentence, reach for Fraunces — otherwise leave it Mono.
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
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/surfaces</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Card</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Card</span> · design-system/surfaces/card.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A bordered surface that lifts a block of related content off the page background
                with a hairline rule and even padding. Use it to group a self-contained unit — a
                demo, a stat panel, a callout. It owns its frame and padding only; the space around
                it is the caller's layout concern.
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

          <article>
            <h4 className="font-mono text-base text-ink">Modal</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Modal</span> · design-system/surfaces/modal.tsx
            </p>
            <Prose>
              <p className="mt-3">
                An overlay dialog built on the native <Code>dialog</Code> element — it sits above an
                inert page on a lifted surface, traps focus, and restores it to the trigger on
                close, all natively. It is open while mounted: render it to open it, and let{" "}
                <Code>onClose</Code> (fired by Escape or a backdrop click) tell the parent to
                unmount. <Code>title</Code> labels the dialog; the body is the children, so the
                footer actions are yours to compose. Reserve it for a focused decision or a short
                form — anything longer belongs on its own page.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ModalDemo />
              </Card>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="content">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="content" className="font-display text-3xl text-ink leading-tight">
            Content
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/content</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Prose</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Prose</span> · design-system/content/prose.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Reading content — a guideline, an article, a rendered summary — goes inside the{" "}
                <Code>Prose</Code> container. It owns the reading measure (about 65 characters wide)
                and the base reading voice, so line length stays comfortable and consistent across
                surfaces. Never put a max-width on text by hand — reach for Prose and let it own the
                width.
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
              design-system/content/inline-link.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A link inside a run of prose or chrome. It is accent-coloured and underlined so it
                reads as a link before any hover. Internal routes navigate client-side; an{" "}
                <Code>href</Code> that points off-app opens in a new tab with a trailing ↗ — read
                from the href, no flag to set. Reach for this for any in-flow link — standalone
                navigation (the side rail, a back link) has its own treatment.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <p>
                    The morning digest pulls highlights from{" "}
                    <InlineLink href="/workflows/daily">the daily workflow</InlineLink> and cites{" "}
                    <InlineLink href="https://example.com">an external source</InlineLink> when the
                    summary quotes one.
                  </p>
                </Prose>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Code</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Code</span> ·{" "}
              <span className="text-ink-muted">CodeBlock</span> · design-system/content/code.tsx
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
                    <Code>design-system</Code> inline, then drop to a block for a full snippet:
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
              <span className="text-ink-muted">List</span> · design-system/content/list.tsx
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

          <article>
            <h4 className="font-mono text-base text-ink">Quote</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Quote</span> · design-system/content/quote.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A block quotation — words lifted from elsewhere, set apart from the body in muted
                italic with a rule down the left edge. Use it for a cited passage, not for emphasis;
                emphasis stays inline.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <Quote>
                    The best automation is the kind you forget is running — it just leaves the right
                    thing in the right place, on time, without being asked.
                  </Quote>
                </Prose>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Table</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Table</span> · design-system/content/table.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Tabular data — the machine layer, so it is set in mono with tabular figures and
                scrolls sideways rather than reflowing. Write semantic <Code>thead</Code>/
                <Code>tbody</Code> markup as children; the rule lines and cell spacing are applied
                for you.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Table>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Duration</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>fetch-sources</td>
                      <td>0.4s</td>
                      <td>ok</td>
                    </tr>
                    <tr>
                      <td>summarise</td>
                      <td>1.1s</td>
                      <td>ok</td>
                    </tr>
                    <tr>
                      <td>publish</td>
                      <td>0.2s</td>
                      <td>ok</td>
                    </tr>
                  </tbody>
                </Table>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Rule</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Rule</span> · design-system/content/rule.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A hairline divider marking a break between passages. It renders the line only — the
                space above and below is the caller's, so it never carries a baked-in margin.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Prose>
                  <p>A passage of content above the break.</p>
                </Prose>
                <div className="my-6">
                  <Rule />
                </div>
                <Prose>
                  <p>And the content that resumes below it.</p>
                </Prose>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Meta</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Meta</span> · design-system/content/meta.tsx
            </p>
            <Prose>
              <p className="mt-3">
                An inline metadata row — a sequence of small machine-layer facts separated by a
                muted middot. List the facts as children and the separator is inserted between each,
                so the dots are never written by hand. The byline above a run or article is the
                canonical use.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Meta>
                  <span>ok</span>
                  <span>2h ago</span>
                  <span>1.2s</span>
                  <span>a1b2c3d</span>
                </Meta>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Stat</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">StatList</span> ·{" "}
              <span className="text-ink-muted">Stat</span> · design-system/content/stat.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A strip of summary figures — a run's counts, an average duration — rendered as a
                description list so each label and figure form a real term–value pair.{" "}
                <Code>StatList</Code> lays its <Code>Stat</Code> children out in a row; each{" "}
                <Code>Stat</Code> sets its figure in mono — a figure is a number, so it stays in the
                machine layer — and takes a <Code>tone</Code>: <Code>ok</Code> tints it green,{" "}
                <Code>failed</Code> red, and the default leaves it in ink.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <StatList>
                  <Stat label="Runs">9</Stat>
                  <Stat label="Ok" tone="ok">
                    8
                  </Stat>
                  <Stat label="Failed" tone="failed">
                    1
                  </Stat>
                  <Stat label="Articles">0</Stat>
                  <Stat label="Avg duration">601ms</Stat>
                </StatList>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Markdown</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Markdown</span> · design-system/content/markdown.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Renders a markdown string into the design system: links, lists, quotes, code,
                tables, and rules all flow through their components, headings carry the Foundations
                scale, and the whole is wrapped in <Code>Prose</Code>. It also supports{" "}
                <InlineLink href="https://vega.github.io/vega-lite/">vega-lite</InlineLink>{" "}
                <Code>chart</Code> blocks, optional section ordinals, and header-level downgrade for
                nesting beneath a page title.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Markdown
                  content={[
                    "## Morning digest",
                    "",
                    "A summary with an [internal link](/workflows/daily), an [external one](https://example.com), and `inline code`.",
                    "",
                    "- First highlight",
                    "- Second highlight",
                    "",
                    "```chart",
                    '{ "width": "container", "height": 140, "data": { "values": [ {"day": "Mon", "runs": 3}, {"day": "Tue", "runs": 5}, {"day": "Wed", "runs": 2}, {"day": "Thu", "runs": 6}, {"day": "Fri", "runs": 4} ] }, "mark": "bar", "encoding": { "x": {"field": "day", "type": "nominal", "sort": ["Mon", "Tue", "Wed", "Thu", "Fri"], "axis": {"title": null}}, "y": {"field": "runs", "type": "quantitative", "axis": {"title": null}} } }',
                    "```",
                    "",
                    "> A line lifted from a source.",
                  ].join("\n")}
                />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Disclosure</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Disclosure</span> ·
              design-system/content/disclosure.tsx
            </p>
            <Prose>
              <p className="mt-3">
                An expand/collapse region — a trigger that toggles one block of content. Use it to
                tuck secondary detail (a script's source, a step's output, advanced options) out of
                the way until it's wanted, so the page leads with what matters. Pass the
                always-shown trigger as <Code>summary</Code> and the revealed content as children;
                it owns its open state, so pass <Code>defaultOpen</Code> when the detail should
                start visible. The trigger and panel are wired with <Code>aria-expanded</Code> /{" "}
                <Code>aria-controls</Code> so assistive tech announces the state. Stack several to
                build an accordion.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="divide-y divide-rule">
                  <Disclosure summary={<span className="font-mono text-sm text-ink">env</span>}>
                    <Prose>
                      <p>
                        The environment variables this step receives, resolved from the workflow's
                        inputs and the host environment.
                      </p>
                    </Prose>
                  </Disclosure>
                  <Disclosure
                    defaultOpen
                    summary={<span className="font-mono text-sm text-ink">source</span>}
                  >
                    <CodeBlock>{'echo "publishing $TITLE"\nkiri publish --draft'}</CodeBlock>
                  </Disclosure>
                </div>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Empty state</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">EmptyState</span> ·
              design-system/content/empty-state.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A "nothing here yet" message in the reading voice — italic Fraunces, muted — so an
                empty list reads as a calm aside rather than a blank gap. Pass the sentence as
                children; inline elements like a <Code>Code</Code> chip weave straight in. Render it
                directly or hand it to a component's empty slot, such as the nav list's{" "}
                <Code>emptyState</Code>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <EmptyState>
                  no workflows yet — run <Code>kiri init</Code> and add YAML to{" "}
                  <Code>workflows/</Code>.
                </EmptyState>
              </Card>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="actions">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="actions" className="font-display text-3xl text-ink leading-tight">
            Actions
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/actions</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Button</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Button</span> · design-system/actions/button.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A button performs an action — it runs, submits, toggles, deletes; it{" "}
                <em>changes</em> something. The line that matters most:{" "}
                <em>buttons act, links navigate</em>. If a control takes the user somewhere —
                another page, a section, an external site — it is a link (the Inline link above),
                never a button wired to navigate on click. A button that navigates throws away
                open-in-new-tab, middle-click, history, and the role a screen reader announces. When
                you are unsure which to reach for, ask whether the control <em>goes somewhere</em>{" "}
                or <em>does something</em>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="flex flex-wrap items-baseline gap-4">
                  <Button variant="primary">run</Button>
                  <Button>copy</Button>
                  <Button variant="negative">delete</Button>
                  <Button variant="dismissive">cancel</Button>
                </div>
                <div className="mt-6 flex flex-wrap items-baseline gap-4">
                  <Button variant="primary" size="lg">
                    run workflow
                  </Button>
                  <Button variant="primary" pending pendingLabel="running…">
                    run
                  </Button>
                  <Button disabled>unavailable</Button>
                </div>
              </Card>
            </div>
            <Prose>
              <p className="mt-5">
                Reach for the variant that matches the action's weight, and keep at most one{" "}
                <Code>primary</Code> on a surface — everything else steps down from it.
              </p>
              <List>
                <li>
                  <Code>primary</Code> — solid accent; the single affirmative call-to-action, the
                  one thing you most want done (run, save, submit). Competing primaries cancel each
                  other out.
                </li>
                <li>
                  <Code>default</Code> — outlined; the everyday standalone action that needs its own
                  edge but isn't the headline (copy, run again, refresh). Most buttons are this.
                </li>
                <li>
                  <Code>negative</Code> — solid red; a destructive, hard-to-undo action (delete,
                  cancel a run mid-flight). Reserve red for genuine consequence so it still makes
                  the user pause — usually behind a confirm.
                </li>
                <li>
                  <Code>dismissive</Code> — borderless; a low-weight action inside chrome that
                  already carries weight, like a dialog's cancel or a dismiss. It sits quietly
                  beside the primary it accompanies.
                </li>
              </List>
              <p className="mt-4">
                Use <Code>size="lg"</Code> only for a true headline action — a hero run button
                crowning a page — and the default <Code>sm</Code> everywhere else. For anything
                asynchronous, pass <Code>pending</Code> with a <Code>pendingLabel</Code>: the label
                swaps for a pulse and the button disables itself, so progress shows and it can't be
                fired twice.
              </p>
            </Prose>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Select</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Select</span> · design-system/actions/select.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The form control for choosing one value from a fixed set — a styled wrapper over the
                native <Code>select</Code>, so keyboard, type-ahead, and the platform picker all
                come for free. Write the <Code>option</Code> elements as children and drive it with{" "}
                <Code>value</Code> / <Code>onChange</Code>. It is the control alone; pair it with a{" "}
                <Code>label</Code> for the field. Reach for a select only for a short, fixed list —
                a long or open-ended set wants a different control.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <SelectDemo />
              </Card>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="navigation">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="navigation" className="font-display text-3xl text-ink leading-tight">
            Navigation
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/navigation</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Breadcrumb</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Breadcrumb</span> ·
              design-system/navigation/breadcrumb.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The path from the root to the page you're on, as a labelled trail. Pass the
                ancestors as <Code>{"{ label, href }"}</Code> in <Code>items</Code> and the page
                you're on as <Code>current</Code>; the ancestors are links (client-side, via wouter)
                and the current page is plain text marked <Code>aria-current</Code>, since a page
                never links to itself. The <Code>/</Code> separators are inserted for you. It is
                wayfinding chrome — quiet by design, so it sits above a page without competing with
                it.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Breadcrumb
                  items={[
                    { label: "Workflows", href: "/workflows" },
                    { label: "pr-review", href: "/workflows/pr-review" },
                  ]}
                  current="run 42"
                />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Tabs</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Tabs</span> · design-system/navigation/tabs.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A deep-linkable tab strip following the WAI-ARIA tabs pattern. The active tab lives
                in a search param (<Code>?tab</Code> by default; set <Code>param</Code> for another
                key), so a panel can be linked to and survives a reload, and arrow keys plus
                Home/End move between tabs. Pass the tabs as <Code>{"{ id, label, content }"}</Code>{" "}
                with a <Code>label</Code> naming the strip; only the active panel renders, so a
                panel's data isn't fetched until its tab is opened. Reach for tabs to switch between
                views of one thing — not to page between unrelated destinations.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Tabs
                  label="Workflow views"
                  tabs={[
                    {
                      id: "runs",
                      label: "Runs",
                      content: (
                        <Prose>
                          <p>The most recent runs of this workflow, newest first.</p>
                        </Prose>
                      ),
                    },
                    {
                      id: "inputs",
                      label: "Inputs",
                      content: (
                        <Prose>
                          <p>The inputs this workflow declares, with their types and defaults.</p>
                        </Prose>
                      ),
                    },
                    {
                      id: "steps",
                      label: "Steps",
                      content: (
                        <Prose>
                          <p>Each step in declared order — the shape of the workflow itself.</p>
                        </Prose>
                      ),
                    },
                  ]}
                />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Toc</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Toc</span> · design-system/navigation/toc.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A table of contents with scroll-spy — the right-rail "in this article" marginalia.
                Pass the headings as <Code>{"{ id, label, ordinal? }"}</Code> in{" "}
                <Code>entries</Code>; each links to its <Code>#id</Code>, and the entry whose target
                is in the reader's active zone (the top of the viewport) is highlighted as a "you
                are here" marker. Collecting the headings is the caller's job — this owns the list
                and the active-tracking. This page's right rail carries a live instance; the
                specimen below is the same component wired to these sections, so both markers track
                as you scroll.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Toc heading="Contents" entries={TOC_ENTRIES} />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Nav list</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">NavList</span> ·
              design-system/navigation/nav-list.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The side rail's titled vertical navigation — an eyebrow heading over a column of
                link rows, each with an accent strip flush to its left edge. <Code>items</Code> is
                an ordered mix of rows and groups: a row is{" "}
                <Code>{"{ label, href, active? }"}</Code>, a group is{" "}
                <Code>{"{ heading, items }"}</Code> — a titled cluster beneath a smaller
                sub-heading. They render in the order given; consecutive rows sit tight while a
                group stands off with space above it. A row links internally through wouter and is
                marked <Code>aria-current</Code> when <Code>active</Code>; a row whose{" "}
                <Code>href</Code> points off-app (a scheme or <Code>{"//"}</Code>) instead opens in
                a new tab with a safe <Code>rel</Code> and a trailing ↗, and is never current — read
                from the href, no flag to set. When <Code>items</Code> is empty an optional{" "}
                <Code>emptyState</Code> renders in its place.
              </p>
              <p className="mt-3">
                Pass <Code>heading</Code> for a labelled <Code>nav</Code> landmark — the usual
                section. Omit it (as the lone <Code>Home</Code> row above) for a bare cluster with
                no landmark and no eyebrow. Stack several — Home, Workflows, Documentation — with
                your own spacing; the component owns no outer margin.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="space-y-10">
                  <NavList items={[{ label: "Home", href: "/", active: true }]} />
                  <NavList
                    heading="Workflows"
                    items={[
                      { label: "pr-review", href: "/workflows/pr-review", active: true },
                      { label: "deploy", href: "/workflows/deploy" },
                      {
                        heading: "Dev",
                        items: [
                          { label: "lint", href: "/workflows/lint" },
                          { label: "test", href: "/workflows/test" },
                        ],
                      },
                      {
                        heading: "Ops",
                        items: [
                          { label: "nightly-backup", href: "/workflows/nightly-backup" },
                          { label: "restore", href: "/workflows/restore" },
                        ],
                      },
                    ]}
                  />
                  <NavList
                    heading="Documentation"
                    items={[
                      { label: "Managing kiri", href: "https://local.kiri.build/docs" },
                      { label: "GitHub", href: "https://github.com/LeeCheneler/kiri" },
                    ]}
                  />
                </div>
              </Card>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="charts">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="charts" className="font-display text-3xl text-ink leading-tight">
            Charts
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/charts</p>
        </header>

        <article>
          <h4 className="font-mono text-base text-ink">Sparkline</h4>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            <span className="text-ink-muted">Sparkline</span> · design-system/charts/sparkline.tsx
          </p>
          <Prose>
            <p className="mt-3">
              A compact bar chart for a run of recent measurements — one bar per value, scaled to
              the largest so the shape reads at a glance. Pass the data as{" "}
              <Code>{"{ value, tone, label? }"}</Code> in <Code>bars</Code>, in display order. Each
              bar's <Code>tone</Code> colours it — <Code>ok</Code>, <Code>warm</Code> for a
              slower-than-usual run, or <Code>failed</Code> — and surfaces as <Code>data-tone</Code>
              ; a near-zero value still draws a stub so gaps don't vanish. <Code>label</Code> names
              the whole chart for assistive tech, and optional <Code>startLabel</Code> /{" "}
              <Code>endLabel</Code> caption the axis ends. It owns no width — size it from the
              caller.
            </p>
          </Prose>
          <div className="mt-5">
            <Card>
              <div className="max-w-md">
                <Sparkline
                  label="Run durations, oldest to newest"
                  bars={SPARKLINE_BARS}
                  startLabel="oldest"
                  endLabel="duration · now"
                />
              </div>
            </Card>
          </div>
        </article>
      </section>

      <section aria-labelledby="feedback">
        <header className="mt-16 mb-6 border-b border-rule pb-3">
          <h3 id="feedback" className="font-display text-3xl text-ink leading-tight">
            Feedback
          </h3>
          <p className="mt-1 font-mono text-xs text-ink-muted">design-system/feedback</p>
        </header>

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Status</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Status</span> · design-system/feedback/status.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The status word for a run or step, tinted in its state's colour. Pass{" "}
                <Code>status</Code> — one of <Code>pending</Code>, <Code>running</Code>,{" "}
                <Code>ok</Code>, <Code>failed</Code>, <Code>cancelled</Code>,{" "}
                <Code>interrupted</Code>. The <Code>running</Code> state adds a pulsing dot as an
                in-flight cue. It exposes the state as <Code>data-status</Code> for containers to
                anchor on, and stays mono — but leaves size and case to the caller, so it drops
                cleanly into a row's chrome.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="flex flex-wrap gap-x-8 gap-y-3 text-xs tracking-widest uppercase">
                  {STATUSES.map((status) => (
                    <Status key={status} status={status} />
                  ))}
                </div>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Status block</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">StatusBlock</span> ·
              design-system/feedback/status-block.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A content block edged on the left with its status colour — the callout for a run or
                step's outcome. Pass <Code>status</Code> and the content as children; the block
                draws a <Code>border-status-*</Code> left edge and exposes <Code>data-status</Code>{" "}
                for containers to anchor on. It owns its border and inset only — stack several with
                your own spacing.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="space-y-4">
                  <StatusBlock status="failed">
                    <p className="font-mono text-sm text-ink">sh: bun test — exited 1</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">
                      3 of 14 assertions failed
                    </p>
                  </StatusBlock>
                  <StatusBlock status="ok">
                    <p className="font-mono text-sm text-ink">publish: weekly digest</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">published in 0.8s</p>
                  </StatusBlock>
                  <StatusBlock status="running">
                    <p className="font-mono text-sm text-ink">sh: gather sources</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">in progress…</p>
                  </StatusBlock>
                </div>
              </Card>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
