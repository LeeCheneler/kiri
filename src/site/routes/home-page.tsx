import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../client/design-system/content/headline-link.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { Card } from "../../client/design-system/surfaces/card.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";
import { CodeWindow } from "../components/code-window.tsx";
import { HeroGraphic } from "../components/hero-graphic.tsx";
import { SessionDiagram } from "../components/session-diagram.tsx";
import { WorkflowDiagram } from "../components/workflow-diagram.tsx";

const INSTALL = `brew install LeeCheneler/kiri/kiri
cd your-project
kiri init
kiri
`;

type Capability = { term: string; detail: string };

const CAPABILITIES: Capability[] = [
  {
    term: "Published articles",
    detail: "Markdown with charts and Mermaid diagrams, rendered inline.",
  },
  {
    term: "Recommendations",
    detail: "Any run can suggest its own follow-ups, one click away.",
  },
  {
    term: "First-party tools",
    detail: "Web search and page extraction, gated on your Tavily key.",
  },
  {
    term: "One activity feed",
    detail: "Workflows and sessions share a single timeline.",
  },
  {
    term: "Your model",
    detail: "Anthropic, OpenAI, or any OpenAI-compatible server.",
  },
  {
    term: "Git-native",
    detail: "Every definition is a file you can diff, commit, and review.",
  },
];

/**
 * Marketing landing page. Leads with a real workflow file as the hero
 * artifact — kiri's own material — set against the editorial display voice,
 * then the two pillars, what's in the box, and install. Composed from the
 * app's design system so it reads as the same product.
 */
export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 sm:px-8">
        <Hero />
        <Pillars />
        <Capabilities />
        <Install />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="grid grid-cols-1 items-start gap-10 py-16 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-14 lg:py-24">
      <div>
        <Eyebrow>Local-first · open source</Eyebrow>
        <h1 className="mt-4 font-display text-5xl text-ink italic leading-[1.04] tracking-tight sm:text-6xl">
          One local-first workbench for AI workflows and agentic sessions.
        </h1>
        <p className="mt-7 max-w-xl font-mono text-sm text-ink-muted leading-relaxed">
          Define a workflow or open an agentic session, run it against your own machine and git
          repo, and publish the result. Bring your own model — Anthropic, OpenAI, or any compatible
          endpoint.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-3 text-lg">
          <HeadlineLink href="/docs">Read the docs</HeadlineLink>
          <HeadlineLink href="https://github.com/LeeCheneler/kiri">View on GitHub</HeadlineLink>
        </div>
        <p className="mt-8 font-mono text-xs text-ink-faint uppercase tracking-widest">
          macOS · Apple silicon · Homebrew
        </p>
      </div>
      <div className="lg:pt-1">
        <HeroGraphic />
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <Eyebrow tone="muted">Two ways to work</Eyebrow>
      <h2 className="mt-3 max-w-2xl font-display text-3xl text-ink leading-tight">
        Scripted when you know the shape of the work — open-ended when you don't.
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <Eyebrow>Workflows</Eyebrow>
          <p className="mt-3 font-mono text-sm text-ink-muted leading-relaxed">
            Versioned YAML pipelines. Chain shell commands, script bundles, and first-party LLM
            steps; pipe each step into the next; publish the run as an article you can share.
          </p>
          <div className="mt-6">
            <WorkflowDiagram />
          </div>
        </Card>
        <Card>
          <Eyebrow>Agentic sessions</Eyebrow>
          <p className="mt-3 font-mono text-sm text-ink-muted leading-relaxed">
            Open-ended chat with first-party tools — like web search — and your project's context. A
            kiri.md file and optional personas layer the system prompt, read fresh from disk each
            turn.
          </p>
          <div className="mt-6">
            <SessionDiagram />
          </div>
        </Card>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section className="border-rule border-t py-16 lg:py-20">
      <Eyebrow tone="muted">What's in the box</Eyebrow>
      <dl className="mt-10 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((cap) => (
          <div key={cap.term}>
            <dt className="font-mono text-sm text-ink">{cap.term}</dt>
            <dd className="mt-1.5 font-mono text-sm text-ink-muted leading-relaxed">
              {cap.detail}
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
            <HeadlineLink href="/docs/getting-started">Read the install guide</HeadlineLink>
          </div>
        </div>
        <div className="lg:pt-1">
          <CodeWindow filename="terminal">{INSTALL}</CodeWindow>
        </div>
      </div>
    </section>
  );
}
