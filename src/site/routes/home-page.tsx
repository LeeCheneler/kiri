import { CopyButton } from "../../client/design-system/actions/copy-button.tsx";
import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";
import { AppWindow } from "../components/app-window.tsx";
import { CodeWindow } from "../components/code-window.tsx";

const QUICKSTART = `brew install LeeCheneler/kiri/kiri
kiri init
kiri
`;

type Feature = { term: string; detail: string };

// The feature set in one scan, directly under the hero. Trust facts live
// inside the features they back rather than in a separate section.
const FEATURES: Feature[] = [
  {
    term: "Agentic sessions",
    detail:
      "Chat, research, review, write, code — one assistant with any model, wired into your files, shell, and tools, permissions yours. Open one, work it out, keep what matters.",
  },
  {
    term: "Local workflows",
    detail:
      "Repeated chores as YAML in your repo — shell steps piped into model steps, runnable as a button.",
  },
  {
    term: "Projects",
    detail:
      "One stream of work in a named place: its sessions, articles, and memories, cross-linked into a shared corpus.",
  },
  {
    term: "MCP servers",
    detail:
      "Extend sessions with any MCP server's tools. Every tool's permission is yours: allow, ask, or off.",
  },
  {
    term: "Any model",
    detail: "Anthropic, OpenAI, or any OpenAI-compatible server — LM Studio, Ollama, vLLM.",
  },
  {
    term: "Local & open source",
    detail:
      "One binary bound to 127.0.0.1, everything stored in SQLite on your disk, every line on GitHub.",
  },
];

type Focus = {
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  href: string;
  linkLabel: string;
};

// The three things kiri leads with, told as short prose. The gallery below
// carries the screenshots, so these stay text-focused.
const FOCUSES: Focus[] = [
  {
    eyebrow: "Agentic sessions",
    title: "Whatever the work is, then written down.",
    body: "A session is a general-purpose agentic assistant with any model you configure — a conversation, a piece of research, a review, a draft, a bug fix. It finds, reads, and edits your files, runs builds, tests, and git, searches the web and your tools through MCP, and hands legwork to a delegated worker. Every write shows as a diff; every tool's permission is yours to set — allow, ask, or off — with an Auto mode for the shell that screens the dangerous and waves through the boring.",
    detail:
      "Then ask it to keep what you worked out: the review, the decision, the release notes land as readable articles in a live feed — not scrollback — and facts persist as memories every future session recalls.",
    href: "/docs/sessions",
    linkLabel: "Read about sessions",
  },
  {
    eyebrow: "Local workflows",
    title: "Automate the repeats.",
    body: "Anything worth doing twice hardens into a workflow: a small YAML file in your repo — shell steps piped into model steps — runnable as a one-click button. Release notes from your git log, the PR queue, the morning brief.",
    detail:
      "A session can author the workflow for you, and runs can pin one-click follow-ups to the feed.",
    href: "/docs/workflows",
    linkLabel: "Writing workflows",
  },
  {
    eyebrow: "Projects",
    title: "Give a body of work a home.",
    body: "A project collects one stream of work in a named place: the sessions that build it and the articles they produce, side by side. Articles wiki-link into a shared corpus, so the tenth session builds on the nine before it instead of starting from zero.",
    detail:
      "Standing instructions steer every session in the project, and project memories keep its facts scoped to where they belong.",
    href: "/docs/projects-and-memories",
    linkLabel: "Projects & memories",
  },
];

type Shot = { src: string; alt: string; title: string };

// Real screenshots of the running app — the proof of polish, gathered into
// one gallery rather than scattered through the prose.
const GALLERY: Shot[] = [
  {
    src: "/screenshots/feed.png",
    alt: "The kiri activity feed: workflow runs with one-line summaries and article links, interleaved with sessions, grouped by day",
    title: "the feed — everything written down",
  },
  {
    src: "/screenshots/session.png",
    alt: "A kiri session: the assistant reports it has written an article into the project corpus and saved a memory, with the project's articles listed in the sidebar",
    title: "session — designing the forecast model",
  },
  {
    src: "/screenshots/article.png",
    alt: "An article in kiri: display typography, a table of contents, and a live bar chart rendered from an inline spec",
    title: "article — chart gallery",
  },
  {
    src: "/screenshots/workflows.png",
    alt: "The kiri workflows page: named workflows with descriptions, last-run status, and a run button on each",
    title: "workflows — one click each",
  },
  {
    src: "/screenshots/project.png",
    alt: "A kiri project page: the project's sessions and the articles they produced listed side by side, with tabs for its standing instructions and memories",
    title: "project — aurora",
  },
];

/**
 * Marketing landing page. The hero states the thesis and hands over the
 * install commands, the feature set lands in one scan directly below, three
 * prose sections go deep on sessions, workflows, and projects, and a gallery
 * of real screenshots — led by the feed — carries the proof. Static by
 * design: no scroll-reveal motion, no illustrations. Composed from the app's
 * design system so the page reads as the product.
 */
export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 sm:px-8">
        <Hero />
        <FeatureSet />
        <Focuses />
        <Gallery />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-3xl">
        <Eyebrow>Local-first · agentic sessions · local workflows</Eyebrow>
        <h1 className="mt-4 font-display text-5xl text-ink italic leading-[1.04] tracking-tight sm:text-6xl">
          The AI workspace that writes things down.
        </h1>
        <p className="mt-6 max-w-2xl font-mono text-sm text-ink-muted leading-relaxed">
          Work you do with an AI usually evaporates into scrollback. In kiri it compounds: sessions
          become readable pages, facts become memories, and repeated chores become one-click buttons
          — all on your machine, in your own repo, with any model you configure.
        </p>
        <div className="mt-8 max-w-md">
          <CodeWindow filename="get started" actions={<CopyButton content={QUICKSTART} />}>
            {QUICKSTART}
          </CodeWindow>
          <p className="mt-3 font-mono text-xs text-ink-faint uppercase tracking-widest">
            macOS · Apple silicon
          </p>
          <p className="mt-2 font-mono text-xs">
            <InlineLink href="/docs/getting-started">Read the quickstart</InlineLink>
          </p>
        </div>
      </div>
    </section>
  );
}

function FeatureSet() {
  return (
    <section className="border-rule border-t py-14 lg:py-16">
      <dl className="grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.term}>
            <dt className="font-mono text-sm text-ink">{feature.term}</dt>
            <dd className="mt-1.5 font-mono text-sm text-ink-muted leading-relaxed">
              {feature.detail}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Focuses() {
  return (
    <div>
      {FOCUSES.map((focus) => (
        <section key={focus.title} className="border-rule border-t py-14 lg:py-16">
          <div className="max-w-3xl">
            <Eyebrow tone="muted">{focus.eyebrow}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink leading-tight">{focus.title}</h2>
            <p className="mt-5 font-mono text-sm text-ink-muted leading-relaxed">{focus.body}</p>
            <p className="mt-4 font-mono text-sm text-ink-muted leading-relaxed">{focus.detail}</p>
            <p className="mt-6 font-mono text-sm">
              <InlineLink href={focus.href}>{focus.linkLabel}</InlineLink>
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}

function Gallery() {
  return (
    <section className="border-rule border-t py-14 lg:py-16">
      <Eyebrow tone="muted">A look around</Eyebrow>
      <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
        {GALLERY.map((shot, index) => (
          <div key={shot.src} className={index === 0 ? "sm:col-span-2" : undefined}>
            <AppWindow src={shot.src} alt={shot.alt} title={shot.title} width={1440} height={900} />
          </div>
        ))}
      </div>
    </section>
  );
}
