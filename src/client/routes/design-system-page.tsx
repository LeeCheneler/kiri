import { useState } from "react";
import { Button } from "../design-system/actions/button.tsx";
import { Checkbox } from "../design-system/actions/checkbox.tsx";
import { Chip } from "../design-system/actions/chip.tsx";
import { Combobox } from "../design-system/actions/combobox.tsx";
import { CopyButton } from "../design-system/actions/copy-button.tsx";
import { SegmentedControl } from "../design-system/actions/segmented-control.tsx";
import { Select } from "../design-system/actions/select.tsx";
import { TextInput } from "../design-system/actions/text-input.tsx";
import { Textarea } from "../design-system/actions/textarea.tsx";
import { ToggleChip } from "../design-system/actions/toggle-chip.tsx";
import { Meter } from "../design-system/charts/meter.tsx";
import { Sparkline, type SparklineBar } from "../design-system/charts/sparkline.tsx";
import { Code, CodeBlock } from "../design-system/content/code.tsx";
import { Diff } from "../design-system/content/diff.tsx";
import { Disclosure } from "../design-system/content/disclosure.tsx";
import { EmptyState } from "../design-system/content/empty-state.tsx";
import { Eyebrow } from "../design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../design-system/content/headline-link.tsx";
import { InlineLink } from "../design-system/content/inline-link.tsx";
import { List } from "../design-system/content/list.tsx";
import { LoadingState } from "../design-system/content/loading-state.tsx";
import { Markdown } from "../design-system/content/markdown.tsx";
import { Meta } from "../design-system/content/meta.tsx";
import { Prose } from "../design-system/content/prose.tsx";
import { Quote } from "../design-system/content/quote.tsx";
import { Rule } from "../design-system/content/rule.tsx";
import { Stat, StatList } from "../design-system/content/stat.tsx";
import { Table } from "../design-system/content/table.tsx";
import { EdgedBlock } from "../design-system/feedback/edged-block.tsx";
import { Notice } from "../design-system/feedback/notice.tsx";
import { StatusBlock } from "../design-system/feedback/status-block.tsx";
import { Status, type StatusKind } from "../design-system/feedback/status.tsx";
import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { NavList } from "../design-system/navigation/nav-list.tsx";
import { Tabs } from "../design-system/navigation/tabs.tsx";
import { Toc, type TocEntry } from "../design-system/navigation/toc.tsx";
import { Card } from "../design-system/surfaces/card.tsx";
import { ConfirmModal } from "../design-system/surfaces/confirm-modal.tsx";
import { Drawer } from "../design-system/surfaces/drawer.tsx";
import { Modal } from "../design-system/surfaces/modal.tsx";
import { Popover } from "../design-system/surfaces/popover.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

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
    <Select
      label="Cadence"
      description="How often the workflow runs on its own."
      value={cadence}
      onChange={setCadence}
    >
      <option value="daily">daily</option>
      <option value="weekly">weekly</option>
      <option value="monthly">monthly</option>
    </Select>
  );
}

// Interactive specimen for the SegmentedControl — one value chosen from a short,
// all-visible set, owning its controlled value.
function SegmentedControlDemo() {
  const [permission, setPermission] = useState<"allow" | "ask" | "off">("ask");
  return (
    <SegmentedControl
      label="Tool permission"
      description="How the assistant may use this tool."
      value={permission}
      onChange={setPermission}
      options={[
        { value: "allow", label: "Always allow" },
        { value: "ask", label: "Ask" },
        { value: "off", label: "Off" },
      ]}
    />
  );
}

// Interactive specimen for the Combobox — a long, searchable list it filters as
// you type. Owns its controlled value, seeded to one of the options.
function ComboboxDemo() {
  const [model, setModel] = useState("anthropic:claude-opus");
  const models = [
    "anthropic:claude-haiku",
    "anthropic:claude-opus",
    "anthropic:claude-sonnet",
    "google:gemini-flash",
    "google:gemini-pro",
    "openai:gpt-4o",
    "openai:gpt-4o-mini",
    "openai:o3",
  ];
  return (
    <Combobox
      label="Model"
      description="Type to filter a long list down to the one you want."
      options={models}
      value={model}
      onChange={setModel}
    />
  );
}

// Interactive specimen for the Combobox's option groups — a pinned shortlist
// leading the full listing, each group set off by a divider and heading.
function ComboboxGroupsDemo() {
  const [model, setModel] = useState("anthropic:claude-haiku");
  return (
    <Combobox
      label="Model"
      description="A pinned group leads; the listing follows, one group per provider."
      options={[
        {
          label: "kiri",
          options: [
            { value: "anthropic:claude-haiku", label: "haiku" },
            { value: "anthropic:claude-sonnet", label: "sonnet" },
            { value: "anthropic:claude-opus", label: "opus" },
          ],
        },
        {
          label: "anthropic",
          options: [
            { value: "anthropic:claude-haiku", label: "claude-haiku" },
            { value: "anthropic:claude-opus", label: "claude-opus" },
            { value: "anthropic:claude-sonnet", label: "claude-sonnet" },
          ],
        },
        { label: "google", options: [{ value: "google:gemini-flash", label: "gemini-flash" }] },
        { label: "openai", options: [{ value: "openai:gpt-4o", label: "gpt-4o" }] },
      ]}
      value={model}
      onChange={setModel}
    />
  );
}

// Interactive specimen for the Checkbox — a small set of independently
// toggleable options, including a disabled one, each owning its checked state.
function CheckboxDemo() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    recipes: true,
    architecture: false,
  });
  const toggle = (name: string) => (checked: boolean) =>
    setEnabled((prev) => ({ ...prev, [name]: checked }));
  return (
    <div className="flex flex-col gap-2">
      <Checkbox label="recipes" checked={enabled.recipes} onChange={toggle("recipes")} />
      <Checkbox
        label="architecture"
        checked={enabled.architecture}
        onChange={toggle("architecture")}
      />
      <Checkbox label="archived (locked)" checked={false} onChange={toggle("archived")} disabled />
    </div>
  );
}

// Interactive specimen for the ToggleChip — a wrap-flow group of independently
// toggleable chips, including a disabled one, each owning its checked state.
function ToggleChipDemo() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    drinks: true,
    science: false,
  });
  const toggle = (name: string) => (checked: boolean) =>
    setEnabled((prev) => ({ ...prev, [name]: checked }));
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip label="drinks" checked={enabled.drinks} onChange={toggle("drinks")} />
      <ToggleChip label="science" checked={enabled.science} onChange={toggle("science")} />
      <ToggleChip
        label="archived (locked)"
        checked={false}
        onChange={toggle("archived")}
        disabled
      />
    </div>
  );
}

// Interactive specimen for the Chip — a wrap-flow row of one-shot suggestions;
// tapping one records it as the sent reply.
function ChipDemo() {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => setSent("Yes, proceed")}>Yes, proceed</Chip>
        <Chip onClick={() => setSent("No, hold off")}>No, hold off</Chip>
        <Chip disabled>Unavailable</Chip>
      </div>
      <p className="font-mono text-xs text-ink-muted">
        {sent === null ? "Nothing sent yet." : `Sent: ${sent}`}
      </p>
    </div>
  );
}

// Interactive specimen for the TextInput control, which owns its controlled value.
function TextInputDemo() {
  const [topic, setTopic] = useState("");
  return (
    <TextInput
      label="Topic"
      description="An optional focus for the briefing."
      placeholder="e.g. semiconductors"
      value={topic}
      onChange={setTopic}
    />
  );
}

// Interactive specimen for the Textarea control — a labelled multi-line field
// and a bare one, both bound to the same state to show either form.
function TextareaDemo() {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-4">
      <Textarea
        label="Notes"
        description="A multi-line jotting; resize it with the grip."
        placeholder="Anything you want to remember…"
        value={draft}
        onChange={setDraft}
      />
      <Textarea
        value={draft}
        onChange={setDraft}
        placeholder="Bare, unlabelled — auto-grows up to four rows, then scrolls"
        rows={2}
        maxRows={4}
      />
    </div>
  );
}

// Interactive specimen for the Modal — a button per size opens a confirm dialog,
// so the `md` (default), `lg`, and `full` widths can be compared side by side.
// Interactive specimen for the Popover — an occasional control cluster folded
// behind its trigger, dismissed by Escape or a click outside. Owns the value
// its control commits.
function PopoverDemo() {
  const [density, setDensity] = useState("comfortable");
  return (
    <Popover trigger="display" label="Display">
      <div className="w-56">
        <SegmentedControl
          label="Density"
          options={[
            { value: "comfortable", label: "comfortable" },
            { value: "compact", label: "compact" },
          ]}
          value={density}
          onChange={setDensity}
        />
      </div>
    </Popover>
  );
}

function ModalDemo() {
  const [size, setSize] = useState<"md" | "lg" | "full" | null>(null);
  const close = () => setSize(null);
  return (
    <>
      <div className="flex gap-4">
        <Button onClick={() => setSize("md")}>open dialog (md)</Button>
        <Button onClick={() => setSize("lg")}>open dialog (lg)</Button>
        <Button onClick={() => setSize("full")}>open dialog (full)</Button>
      </div>
      {size && (
        <Modal title={`Discard draft? (${size})`} onClose={close} size={size}>
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

// Interactive specimen for the ConfirmModal — one trigger per emphasis, so the
// default `primary` confirm and the destructive `negative` one can be compared.
function ConfirmModalDemo() {
  const [variant, setVariant] = useState<"primary" | "negative" | null>(null);
  const close = () => setVariant(null);
  return (
    <>
      <div className="flex gap-4">
        <Button onClick={() => setVariant("primary")}>confirm an action</Button>
        <Button variant="negative" onClick={() => setVariant("negative")}>
          confirm a destructive action
        </Button>
      </div>
      {variant === "primary" && (
        <ConfirmModal
          title="Run again?"
          body="The previous attempt's outputs will be cleared."
          confirmLabel="run again"
          onConfirm={close}
          onCancel={close}
        />
      )}
      {variant === "negative" && (
        <ConfirmModal
          title="Delete this run?"
          body="This cannot be undone."
          confirmLabel="delete"
          variant="negative"
          onConfirm={close}
          onCancel={close}
        />
      )}
    </>
  );
}

// Interactive specimen for the Drawer — a button opens a left side panel
// hosting navigation, the way the site rail does on small screens.
function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>open drawer</Button>
      {open && (
        <Drawer title="Navigation" onClose={() => setOpen(false)}>
          <NavList
            heading="Workflows"
            items={[
              { label: "pr-review", href: "/workflows/pr-review", active: true },
              { label: "deploy", href: "/workflows/deploy" },
            ]}
          />
        </Drawer>
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

const STATUSES: StatusKind[] = [
  "pending",
  "running",
  "working",
  "idle",
  "ok",
  "failed",
  "cancelled",
  "interrupted",
];

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
 * Dev-only living design system route. Composes the catalogue into the
 * page shell, with its section table of contents as right-rail
 * marginalia.
 */
export function DesignSystemPage() {
  return (
    <PageShell left={<SiteNav />} right={<DesignSystemAside />}>
      <DesignSystemContent />
    </PageShell>
  );
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
export function DesignSystemContent() {
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
                footer actions are yours to compose, and <Code>size</Code> (<Code>md</Code> default,{" "}
                <Code>lg</Code>, <Code>full</Code>) widens it — from a richer body up to a
                viewport-spanning surface for content like a zoomable diagram. Reserve it for a
                focused decision or a short form — anything longer belongs on its own page, and a
                bare yes/no question belongs in the <Code>ConfirmModal</Code> below.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ModalDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">ConfirmModal</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">ConfirmModal</span> ·
              design-system/surfaces/confirm-modal.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A <Code>Modal</Code> specialised to a single yes/no decision — the in-app
                replacement for the browser's native confirm, so a pause-before-proceeding never
                leaves kiri's surface. <Code>title</Code> asks the question, <Code>body</Code>{" "}
                states the consequence, and <Code>confirmLabel</Code> names the confirming action;{" "}
                <Code>variant</Code> sets that button's emphasis — <Code>negative</Code> for
                destructive actions, <Code>primary</Code> (default) otherwise. The cancel button,
                Escape, and a backdrop click all route to <Code>onCancel</Code>. Anything that
                collects input is a form in a <Code>Modal</Code> instead.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ConfirmModalDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Drawer</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Drawer</span> · design-system/surfaces/drawer.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A left-anchored, full-height panel built on the native <Code>dialog</Code> element —
                the same inert-background, focus-trap, Escape, and focus-restore machinery as the{" "}
                <Code>Modal</Code>, but sliding in from the edge as an off-canvas surface. It is
                open while mounted: render it to open it, and let <Code>onClose</Code> (fired by
                Escape or a backdrop click) tell the parent to unmount. <Code>title</Code> labels
                the panel; the body is the children, which fill the column and scroll when they
                overflow. Reach for it for navigation or a side panel — the small-screen home for
                chrome that sits in a rail on wider viewports.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <DrawerDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Popover</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Popover</span> · design-system/surfaces/popover.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A trigger button owning a small floating panel — for a cluster of controls that's
                reached for occasionally and shouldn't occupy the surface it serves (a composer
                toolbar's model settings, a list's display options). <Code>trigger</Code> names the
                button and <Code>label</Code> names the panel, a non-modal <Code>dialog</Code>: the
                page behind stays live, unlike the <Code>Modal</Code> above. The panel opens under
                the trigger, flipping above it when the viewport leaves too little room underneath,
                and <Code>align</Code> pins it to the trigger's <Code>start</Code> (default) or{" "}
                <Code>end</Code> edge. Escape and a click outside dismiss it, Escape handing focus
                back to the trigger; the panel owns frame and padding only, so the children dictate
                its size. Reserve it for controls: content that needs reading room belongs in a{" "}
                <Code>Modal</Code> or on the page.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <PopoverDemo />
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
                <Code>Prose</Code> container. It owns the reading measure (about 75 characters wide)
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
            <h4 className="font-mono text-base text-ink">Headline link</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">HeadlineLink</span> ·
              design-system/content/headline-link.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A standalone link to a destination — the title of a thing you click through to, not
                a word inside a sentence. Set in the display face and ink-coloured so it reads as a
                heading at rest; a trailing arrow tints accent and nudges along on hover. It
                inherits its font-size from the surrounding element, so the caller picks the scale.
                Internal routes trail a <Code>→</Code>; an <Code>href</Code> that points off-app
                opens in a new tab and trails a ↗ instead. Reach for this for a run, an article, or
                any entity you list and link — prose links are <Code>InlineLink</Code>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ul className="space-y-3 text-xl">
                  <li>
                    <HeadlineLink href="/runs/demo">Weekly Digest — May 30</HeadlineLink>
                  </li>
                  <li>
                    <HeadlineLink href="https://example.com">An external report</HeadlineLink>
                  </li>
                </ul>
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
            <h4 className="font-mono text-base text-ink">Diff</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Diff</span> ·{" "}
              <span className="text-ink-muted">patchFromStrings</span> ·
              design-system/content/diff.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A file change as a unified diff: hunk headers as faint separators feeding old/new
                line numbers into the gutter, additions in the ok tone, removals in the failed tone.
                Pass the hunk-only patches the filesystem write tools produce, or build a
                header-less pseudo-diff from two whole strings with <Code>patchFromStrings</Code>{" "}
                when only the before/after sides are known — a one-sided pseudo (a whole file
                arriving or going) numbers from 1, a mixed one drops the number gutters entirely.{" "}
                <Code>truncated</Code> appends a note that the server cut the diff short.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Diff
                  patch={[
                    "@@ -12,7 +12,7 @@",
                    " export function greet(name) {",
                    '-  return "Hello, " + name;',
                    "+  return `Hello, ${name}!`;",
                    " }",
                  ].join("\n")}
                />
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
                      <li>Summarise and write up the result.</li>
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
                      <td>article</td>
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
            <h4 className="font-mono text-base text-ink">Eyebrow</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Eyebrow</span> · design-system/content/eyebrow.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The small mono uppercase kicker above a page title or section heading. The default{" "}
                <Code>accent</Code> tone is a page's lead eyebrow — it colours the kicker so the
                title reads as the page's opening — while <Code>muted</Code> heads a section{" "}
                <em>within</em> a page, where an accent kicker would compete with the lead.{" "}
                <Code>faint</Code> is quieter still, for a label heading a group nested inside a row
                or card — a feed row's article count, say — where even a muted kicker would read as
                loud as the content it introduces.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="space-y-5">
                  <div>
                    <Eyebrow>Dev · Workflow</Eyebrow>
                    <p className="mt-2 font-display text-3xl text-ink italic leading-tight">
                      pr-review
                    </p>
                  </div>
                  <Eyebrow tone="muted">Steps</Eyebrow>
                  <Eyebrow tone="faint">2 articles</Eyebrow>
                </div>
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
                <Code>failed</Code> red, and the default leaves it in ink. <Code>size</Code> scales
                the figure: <Code>lg</Code> (default) for a headline strip, <Code>sm</Code> for a
                side rail where a hero number would shout over its neighbours.
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
            <div className="mt-3">
              <Card>
                <StatList>
                  <Stat label="in" size="sm">
                    128
                  </Stat>
                  <Stat label="out" size="sm">
                    512
                  </Stat>
                  <Stat label="total" size="sm">
                    640
                  </Stat>
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
                <Code>chart</Code> blocks and <Code>mermaid</Code> diagrams (see below), optional
                section ordinals, and header-level downgrade for nesting beneath a page title.
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
            <h4 className="font-mono text-base text-ink">Mermaid</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Mermaid</span> · design-system/content/mermaid.tsx
            </p>
            <Prose>
              <p className="mt-3">
                Renders a fenced <Code>mermaid</Code> block — flowcharts, sequence diagrams, and the
                rest of <InlineLink href="https://mermaid.js.org/">mermaid's</InlineLink> grammar —
                as a diagram, themed from the design tokens so it sits in the same palette as the
                page. The <span className="text-ink-muted">Diagram</span> tab leads; a{" "}
                <span className="text-ink-muted">Source</span> tab reveals the raw text with a copy
                action. mermaid renders in its <Code>strict</Code> security mode (its DOMPurify pass
                sanitises the SVG), so a malformed or hostile diagram degrades to an inline notice
                rather than breaking the surrounding article. The bundle is loaded lazily, only when
                a document actually contains a diagram.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <Markdown
                  content={[
                    "```mermaid",
                    "flowchart LR",
                    "  Poll[Poll source] --> Decide{New items?}",
                    "  Decide -- yes --> Run[Run workflow]",
                    "  Decide -- no --> Wait[Wait]",
                    "  Run --> Article[Write article]",
                    "```",
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
                    <CodeBlock>{'echo "rendering $TITLE"\nkiri render --draft'}</CodeBlock>
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

          <article>
            <h4 className="font-mono text-base text-ink">Loading state</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">LoadingState</span> ·
              design-system/content/loading-state.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The loading twin of the empty state — the same muted, italic line, but rendered as
                an <Code>output</Code> with <Code>role="status"</Code> so assistive tech announces
                the body settling, and given a slow shimmer to signal liveness (it stills under{" "}
                <Code>prefers-reduced-motion</Code>). Reach for it while a surface's content is
                mid-fetch; swap to the real content, or an <Code>EmptyState</Code>, once it
                resolves.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <LoadingState>Loading workflow…</LoadingState>
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
                  <Button variant="negative-quiet">delete session</Button>
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
                <div className="mt-6">
                  <Meta>
                    <span>created 8 minutes ago</span>
                    <Button variant="dismissive" size="inline">
                      rename project
                    </Button>
                    <Button variant="negative-quiet" size="inline">
                      delete project
                    </Button>
                  </Meta>
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
                  <Code>negative-quiet</Code> — borderless, muted until hovered, when the red shows;
                  a destructive action that's rare enough it shouldn't dominate its surface (delete
                  a session from its rail). The lighter weight is not lighter consequence — keep the
                  confirm.
                </li>
                <li>
                  <Code>dismissive</Code> — borderless; a low-weight action inside chrome that
                  already carries weight, like a dialog's cancel or a dismiss. It sits quietly
                  beside the primary it accompanies.
                </li>
              </List>
              <p className="mt-4">
                Use <Code>size="lg"</Code> only for a true headline action — a hero run button
                crowning a page — and the default <Code>sm</Code> everywhere else.{" "}
                <Code>size="inline"</Code> drops the padding so a borderless action can sit in a run
                of text as one more item — an owner's rename and delete trailing a <Code>Meta</Code>{" "}
                byline, as above — where <Code>sm</Code>'s padding would push the separators out of
                true. Pair it with <Code>dismissive</Code> or <Code>negative-quiet</Code>; a
                bordered variant needs its padding. For anything asynchronous, pass{" "}
                <Code>pending</Code> with a <Code>pendingLabel</Code>: the label swaps for a pulse
                and the button disables itself, so progress shows and it can't be fired twice.
              </p>
            </Prose>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Copy button</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">CopyButton</span> ·
              design-system/actions/copy-button.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A <Code>default</Code> button wired to write <Code>content</Code> to the system
                clipboard. The write is invisible, so on success it swaps its label to{" "}
                <Code>copiedLabel</Code> for a beat before reverting — the feedback the user needs
                to know it took. If the clipboard rejects (an insecure context, denied permission)
                it surfaces the reason inline beside the button rather than failing silently. Pass{" "}
                <Code>label</Code> to name what's copied so the control stays content-agnostic —
                "copy markdown", "copy link", "copy SHA".
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="flex flex-wrap items-baseline gap-4">
                  <CopyButton content="the quick brown fox" />
                  <CopyButton content="# The morning briefing" label="copy markdown" />
                </div>
              </Card>
            </div>
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
                <Code>value</Code> / <Code>onChange</Code>. Pass a <Code>label</Code> to render the
                field lockup — the label, an optional <Code>description</Code> help line, and a{" "}
                <Code>required</Code> marker, all wired for assistive tech — or omit it for the bare
                control. Reach for a select only for a short, fixed list — a long or open-ended set
                wants a different control.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <SelectDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Combobox</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Combobox</span> · design-system/actions/combobox.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The searchable single-select — a text input that filters a long list as you type,
                with a listbox popup beneath it. Drive it with <Code>value</Code> /{" "}
                <Code>onChange</Code> and pass the full set as <Code>options</Code> (each string its
                own label). <Code>↑</Code>/<Code>↓</Code> move the highlight, <Code>Enter</Code> or
                a click commits it, and <Code>Escape</Code> or a click outside dismisses without
                changing the value. It shares the field lockup — pass a <Code>label</Code> for the
                label, optional <Code>description</Code>, and <Code>required</Code> marker. The list
                opens beneath the input, flipping above it when the viewport leaves too little room
                underneath. Reach for it over <Code>Select</Code> once the list is long enough that
                scanning a native dropdown is painful.
              </p>
              <p>
                To section the list, pass <Code>{"{ label?, options }"}</Code> groups instead of a
                flat set: each group after the first opens with a divider, a <Code>label</Code>{" "}
                renders as a small heading above its options, and a filter that empties a group
                hides it entirely. Use it to pin a shortlist — recommended entries, recents — ahead
                of the full listing without the call site faking it with prefix entries.
              </p>
            </Prose>
            <div className="mt-5 space-y-4">
              <Card>
                <ComboboxDemo />
              </Card>
              <Card>
                <ComboboxGroupsDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Segmented control</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">SegmentedControl</span> ·
              design-system/actions/segmented-control.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A row of mutually-exclusive segments for choosing one value from a short, fixed set
                when seeing every option at once matters — <Code>allow</Code> / <Code>ask</Code> /{" "}
                <Code>off</Code>. Drive it with <Code>value</Code> / <Code>onChange</Code> and pass
                the choices as <Code>options</Code>. Each segment wraps a visually-hidden native
                radio in one group, so the role and arrow-key navigation come for free and the row
                carries the <Code>radiogroup</Code> role. Pass a <Code>label</Code> for the field
                lockup or <Code>aria-label</Code> for a bare control. Reach for <Code>Select</Code>{" "}
                once the list is long enough that showing every option inline is unwieldy, or{" "}
                <Code>ToggleChip</Code> for an on/off toggle.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <SegmentedControlDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Text input</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">TextInput</span> ·
              design-system/actions/text-input.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The single-line text field — a styled wrapper over the native <Code>input</Code>,
                controlled with <Code>value</Code> / <Code>onChange</Code>. Like the select, it
                shares the field lockup: pass a <Code>label</Code> and it renders the label, an
                optional <Code>description</Code> help line, and a <Code>required</Code> marker, all
                wired so the label and help text are announced together. Omit the label for the bare
                control when the caller owns the labelling.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <TextInputDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Textarea</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Textarea</span> · design-system/actions/textarea.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The multi-line counterpart to the text input — a styled wrapper over the native{" "}
                <Code>textarea</Code>, controlled with <Code>value</Code> / <Code>onChange</Code>{" "}
                and sharing the same field lockup and assistive-tech wiring. Pass <Code>rows</Code>{" "}
                to set the resting height; it stays vertically resizable, or pass{" "}
                <Code>maxRows</Code> to make it auto-grow with its content up to that many rows —
                then scroll — with the grip removed. Reach for it over the text input whenever the
                value runs long — a chat message, a prompt, freeform notes. Omit the label for the
                bare control when the caller owns the labelling. When a wrapping surface owns the
                chrome — a composer frame with its own border, focus ring, and toolbar — pass{" "}
                <Code>bare</Code> to drop the control's border and background so it sits flush
                inside, and name it with <Code>aria-label</Code> if no visible label applies.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <TextareaDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Checkbox</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Checkbox</span> · design-system/actions/checkbox.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A single on/off toggle with an inline <Code>label</Code> — a styled wrapper over the
                native checkbox, driven by <Code>checked</Code> / <Code>onChange</Code> (which
                receives the next boolean). The whole label is the click target, and{" "}
                <Code>disabled</Code> dims the row and blocks it. It stays native, so the checkbox
                role and keyboard toggle come for free. Reach for it to switch an independent option
                on or off; to choose one value from a set use <Code>Select</Code> or{" "}
                <Code>Combobox</Code>, and stack several checkboxes for a multi-select.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <CheckboxDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">ToggleChip</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">ToggleChip</span> ·
              design-system/actions/toggle-chip.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A pill-shaped on/off toggle — a <Code>Checkbox</Code> rendered as a chip, driven by
                the same <Code>checked</Code> / <Code>onChange</Code> contract. The whole pill is
                the click target and fills with the accent when on; <Code>disabled</Code> dims and
                blocks it. It wraps a visually-hidden native checkbox, so the role and keyboard
                toggle come for free. Reach for it for compact multi-select that wraps inline —
                filter tags and facets — laid out in a <Code>flex flex-wrap</Code>; for a vertical
                list of options use <Code>Checkbox</Code>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ToggleChipDemo />
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Chip</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Chip</span> · design-system/actions/chip.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A pill-shaped one-shot action — the chip form on a plain button, driven by{" "}
                <Code>onClick</Code>. Where <Code>ToggleChip</Code> is a checkbox holding on/off
                state, this fires once and holds nothing: reach for it when a compact tappable
                suggestion acts immediately — a suggested reply above a composer, a ready-made
                refinement. Same wrap-inline layout as <Code>ToggleChip</Code> (
                <Code>flex flex-wrap</Code>); <Code>disabled</Code> dims and blocks it. For a
                standalone action with button weight use <Code>Button</Code>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <ChipDemo />
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
                views of one thing — not to page between unrelated destinations. For an inline
                widget that can appear many times in one document (where URL-coupled state would
                collide), pass <Code>local</Code> to hold the active tab in component state instead.
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
                      { label: "Managing kiri", href: "https://kiri.build/docs" },
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

        <div className="space-y-12">
          <article>
            <h4 className="font-mono text-base text-ink">Sparkline</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Sparkline</span> · design-system/charts/sparkline.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A compact bar chart for a run of recent measurements — one bar per value, scaled to
                the largest so the shape reads at a glance. Pass the data as{" "}
                <Code>{"{ value, tone, label? }"}</Code> in <Code>bars</Code>, in display order.
                Each bar's <Code>tone</Code> colours it — <Code>ok</Code>, <Code>warm</Code> for a
                slower-than-usual run, or <Code>failed</Code> — and surfaces as{" "}
                <Code>data-tone</Code>; a near-zero value still draws a stub so gaps don't vanish.{" "}
                <Code>label</Code> names the whole chart for assistive tech, and optional{" "}
                <Code>startLabel</Code> / <Code>endLabel</Code> caption the axis ends. It owns no
                width — size it from the caller.
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

          <article>
            <h4 className="font-mono text-base text-ink">Meter</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Meter</span> · design-system/charts/meter.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A slim gauge for consumption of a fixed budget — a session's context window, a
                quota, anything with a hard ceiling. <Code>value</Code> over <Code>max</Code> sets
                the fill, clamped to the track, and a non-zero value always draws a visible sliver
                so a barely-used budget doesn't read as empty. <Code>tone</Code> escalates the fill
                colour as the budget tightens — <Code>accent</Code> at rest, <Code>warning</Code>{" "}
                when it's worth watching, <Code>negative</Code> when it's critical — and surfaces as{" "}
                <Code>data-tone</Code>. <Code>label</Code> names the gauge for assistive tech; put
                the numbers behind it in a <Code>Meta</Code> caption alongside rather than on the
                bar. It owns no width — size it from the caller.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="max-w-md space-y-6">
                  <div className="space-y-2">
                    <Meter value={27_393} max={1_048_576} label="Context used" />
                    <Meta>
                      <span className="tabular-nums">27,393 / 1,048,576 tokens</span>
                    </Meta>
                  </div>
                  <div className="space-y-2">
                    <Meter value={188_000} max={200_000} label="Context used" tone="warning" />
                    <Meta>
                      <span className="tabular-nums">188,000 / 200,000 tokens</span>
                    </Meta>
                  </div>
                </div>
              </Card>
            </div>
          </article>
        </div>
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
                The status word for a run, step, or session, tinted in its state's colour. Pass{" "}
                <Code>status</Code> — runs use <Code>pending</Code>, <Code>running</Code>,{" "}
                <Code>ok</Code>, <Code>interrupted</Code>; sessions use <Code>idle</Code> (resting
                between turns) and <Code>working</Code> (a turn streaming); <Code>failed</Code> and{" "}
                <Code>cancelled</Code> are shared. The in-flight states (<Code>running</Code>,{" "}
                <Code>working</Code>) add a pulsing dot as a live cue. It exposes the state as{" "}
                <Code>data-status</Code> for containers to anchor on, and upper-cases the word and
                stays mono — leaving size to the caller, so it drops cleanly into a row's chrome.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="flex flex-wrap gap-x-8 gap-y-3 text-xs tracking-widest">
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
                step's outcome, or a session row (a green <Code>idle</Code> edge, a blue{" "}
                <Code>working</Code> one). Pass <Code>status</Code> and the content as children; the
                block draws a <Code>border-status-*</Code> left edge and exposes{" "}
                <Code>data-status</Code> for containers to anchor on. It owns its border and inset
                only — stack several with your own spacing.
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
                    <p className="font-mono text-sm text-ink">articles: weekly digest</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">rendered in 0.8s</p>
                  </StatusBlock>
                  <StatusBlock status="running">
                    <p className="font-mono text-sm text-ink">sh: gather sources</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">in progress…</p>
                  </StatusBlock>
                  <StatusBlock status="working">
                    <p className="font-mono text-sm text-ink">anthropic:claude-haiku-4-5</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">session · working</p>
                  </StatusBlock>
                  <StatusBlock status="idle">
                    <p className="font-mono text-sm text-ink">openai:gpt-4o-mini</p>
                    <p className="mt-1 font-mono text-xs text-ink-muted">session · idle</p>
                  </StatusBlock>
                </div>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Edged block</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">EdgedBlock</span> ·
              design-system/feedback/edged-block.tsx
            </p>
            <Prose>
              <p className="mt-3">
                The same left edge as <Code>StatusBlock</Code>, drawn in accent for an entry with no
                lifecycle to report. An article in the activity feed is the case it exists for:
                sitting among status-edged run and session rows, the accent edge says it is
                something the system <em>produced</em> rather than something the system did. It
                exposes <Code>data-edge</Code> rather than <Code>data-status</Code> — there is no
                state to report. Whenever the entry does have one, use <Code>StatusBlock</Code>.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <EdgedBlock>
                  <p className="font-mono text-xs text-ink-muted">
                    <span className="text-accent uppercase">article</span> · morning briefing · 20
                    hours ago
                  </p>
                  <p className="mt-1 font-display text-base text-ink">
                    Tuesday briefing: three things that actually moved
                  </p>
                </EdgedBlock>
              </Card>
            </div>
          </article>

          <article>
            <h4 className="font-mono text-base text-ink">Notice</h4>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              <span className="text-ink-muted">Notice</span> · design-system/feedback/notice.tsx
            </p>
            <Prose>
              <p className="mt-3">
                A toned advisory callout for config-health findings, degraded-feature notices, and
                similar messages. Pass <Code>tone</Code> — <Code>informational</Code>,{" "}
                <Code>warning</Code>, or <Code>negative</Code> — a <Code>title</Code>, and optional
                detail as children; the block draws a tone-coloured left edge with a tinted title
                over muted detail, and exposes <Code>data-tone</Code> for containers to anchor on.
                Set <Code>announce</Code> (<Code>polite</Code> renders a native <Code>output</Code>;{" "}
                <Code>assertive</Code> interrupts) to have a screen reader read it out when it
                appears. Distinct from StatusBlock, which speaks the run/session status vocabulary;
                reach for Notice when the message is advisory rather than a run's outcome.
              </p>
            </Prose>
            <div className="mt-5">
              <Card>
                <div className="space-y-4">
                  <Notice tone="informational" title="No workflows defined">
                    Add a <Code>workflows/&lt;name&gt;.yaml</Code> file to define one.
                  </Notice>
                  <Notice tone="warning" title="No LLM providers configured">
                    Declare a provider in kiri.yaml to enable sessions and llm: steps.
                  </Notice>
                  <Notice tone="negative" title="anthropic: ANTHROPIC_API_KEY is not set">
                    The provider cannot authenticate until the key is set in the environment.
                  </Notice>
                </div>
              </Card>
            </div>
          </article>
        </div>
      </section>
    </section>
  );
}
