import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../client/design-system/content/headline-link.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { Card } from "../../client/design-system/surfaces/card.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";
import { CodeWindow } from "../components/code-window.tsx";
import { HeroArtifact } from "../components/hero-artifact.tsx";
import { SessionDiagram } from "../components/session-diagram.tsx";

const INSTALL = `brew install LeeCheneler/kiri/kiri
cd your-project
kiri init
kiri
`;

type UseCase = { name: string; detail: string };

const USE_CASES: UseCase[] = [
  {
    name: "Release notes",
    detail:
      "git log in, grouped notes out. The article lands in your feed, ready to paste wherever your users read them.",
  },
  {
    name: "One-click PR reviews",
    detail:
      "One run finds every PR waiting on you and pins a Review button to each. Click one, get a review article.",
  },
  {
    name: "Daily briefing",
    detail:
      "Pull the sources you care about and have a model write the morning's brief — charts included.",
  },
];

type Step = { title: string; detail: string };

const STEPS: Step[] = [
  {
    title: "Write a file",
    detail:
      "Steps in YAML, in your repo: sh: for commands, llm: for model calls, piped top to bottom. Diff it, commit it, review it like any other code.",
  },
  {
    title: "Click Run",
    detail:
      "Kiri runs the pipeline on your machine, as you — your gh, your ssh, your tools. Watch every step stream on the run page.",
  },
  {
    title: "Read the report",
    detail:
      "Articles — markdown with charts and diagrams — land in your feed with a one-line summary. A run can even recommend the next click.",
  },
];

type Assurance = { term: string; detail: string };

const ASSURANCES: Assurance[] = [
  {
    term: "Local-only",
    detail: "The server binds to 127.0.0.1 and runs against your own repo. Nothing phones home.",
  },
  {
    term: "Git-native",
    detail: "Every definition is a file you can diff, commit, and review. Edits apply live.",
  },
  {
    term: "Bring your own model",
    detail: "Anthropic, OpenAI, or any OpenAI-compatible server — LM Studio, Ollama, vLLM.",
  },
  {
    term: "No daemons",
    detail: "Kiri works only while you have it open. No cron, no background agents.",
  },
  {
    term: "Approval-gated tools",
    detail: "An MCP tool call runs only after you allow it — every call, unless you say otherwise.",
  },
  {
    term: "Open source",
    detail: "One binary, and every line of it on GitHub.",
  },
];

/**
 * Marketing landing page. Leads with the workspace-where-work-compounds
 * framing (see docs/positioning.md), proven immediately by the input → output
 * hero artifact: a real workflow file and the article it produces. Concrete
 * use cases, the three-beat mechanism, and the trust story follow, then
 * install. Composed from the app's design system so it reads as the same
 * product.
 */
export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 sm:px-8">
        <Hero />
        <UseCases />
        <HowItWorks />
        <Assurances />
        <Install />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="py-16 lg:py-20">
      <div className="max-w-3xl">
        <Eyebrow>Local-first · open source</Eyebrow>
        <h1 className="mt-4 font-display text-5xl text-ink italic leading-[1.04] tracking-tight sm:text-6xl">
          The AI workspace that writes things down.
        </h1>
        <p className="mt-7 max-w-2xl font-mono text-sm text-ink-muted leading-relaxed">
          Work it out in chat, with models wired into your files and tools. What matters lands as
          readable pages in a live feed — not scrollback — and what repeats hardens into a one-click
          workflow: release notes from your git log, a PR review, a morning briefing. Your machine,
          your repo, your keys — no cloud, no daemons.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-3 text-lg">
          <HeadlineLink href="/docs/getting-started">Get started</HeadlineLink>
          <HeadlineLink href="https://github.com/LeeCheneler/kiri">View on GitHub</HeadlineLink>
        </div>
        <p className="mt-8 font-mono text-xs text-ink-faint uppercase tracking-widest">
          macOS · Apple silicon · Homebrew
        </p>
      </div>
      <div className="mt-14 lg:mt-16">
        <HeroArtifact />
      </div>
    </section>
  );
}

function UseCases() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <Eyebrow tone="muted">What you'd use it for</Eyebrow>
      <h2 className="mt-3 max-w-2xl font-display text-3xl text-ink leading-tight">
        Start with a chore you already do.
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
        {USE_CASES.map((useCase) => (
          <Card key={useCase.name}>
            <Eyebrow>{useCase.name}</Eyebrow>
            <p className="mt-3 font-mono text-sm text-ink-muted leading-relaxed">
              {useCase.detail}
            </p>
            <p className="mt-5 font-mono text-sm">
              <InlineLink href="/docs/recipes">See the recipe</InlineLink>
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <Eyebrow tone="muted">How it works</Eyebrow>
      <h2 className="mt-3 max-w-2xl font-display text-3xl text-ink leading-tight">
        A file, a button, a report.
      </h2>
      <ol className="mt-10 grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="font-display text-2xl text-accent italic">{i + 1}</span>
            <h3 className="mt-2 font-mono text-sm text-ink">{step.title}</h3>
            <p className="mt-1.5 font-mono text-sm text-ink-muted leading-relaxed">{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="mt-12">
        <Card>
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
            <div>
              <Eyebrow>Sessions</Eyebrow>
              <h3 className="mt-3 font-display text-2xl text-ink leading-tight">
                No script for it yet? Start where every chore starts: a session.
              </h3>
              <p className="mt-3 max-w-xl font-mono text-sm text-ink-muted leading-relaxed">
                Chat with the same models — wired into your files and shell, extended by any MCP
                server you configure, every risky action waiting on your approval. Sessions write
                their findings up as articles, remember durable facts across conversations, and can
                author the workflow when the work turns out to repeat.
              </p>
              <p className="mt-5 font-mono text-sm">
                <InlineLink href="/docs/sessions">Read about sessions</InlineLink>
              </p>
            </div>
            <SessionDiagram />
          </div>
        </Card>
      </div>
    </section>
  );
}

function Assurances() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <Eyebrow tone="muted">Built to be trusted</Eyebrow>
      <dl className="mt-10 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {ASSURANCES.map((assurance) => (
          <div key={assurance.term}>
            <dt className="font-mono text-sm text-ink">{assurance.term}</dt>
            <dd className="mt-1.5 font-mono text-sm text-ink-muted leading-relaxed">
              {assurance.detail}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Install() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-14">
        <div>
          <Eyebrow>Get started</Eyebrow>
          <h2 className="mt-3 font-display text-3xl text-ink leading-tight">
            Three commands and you're running.
          </h2>
          <p className="mt-5 max-w-md font-mono text-sm text-ink-muted leading-relaxed">
            Install with Homebrew, scaffold a starter workflow, and launch. Then open{" "}
            <InlineLink href="https://local.kiri.build">local.kiri.build</InlineLink> — kiri serves
            its interface from your own running process.
          </p>
          <div className="mt-7 text-lg">
            <HeadlineLink href="/docs/getting-started">Read the quickstart</HeadlineLink>
          </div>
        </div>
        <div className="lg:pt-1">
          <CodeWindow filename="terminal">{INSTALL}</CodeWindow>
        </div>
      </div>
    </section>
  );
}
