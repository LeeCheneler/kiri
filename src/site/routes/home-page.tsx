import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { HeadlineLink } from "../../client/design-system/content/headline-link.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";
import { AppWindow } from "../components/app-window.tsx";
import { CodeWindow } from "../components/code-window.tsx";

const INSTALL = `brew install LeeCheneler/kiri/kiri
cd your-project
kiri init
kiri
`;

type Rung = {
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  href: string;
  linkLabel: string;
  screenshot: { src: string; alt: string; title: string };
};

// The three rungs of the ladder, each proven by a real screenshot of the
// running app rather than an illustration of it.
const RUNGS: Rung[] = [
  {
    eyebrow: "01 · Chat",
    title: "Work it out in chat.",
    body: "A session is streaming chat with your own models, wired into your files and shell and extended by any MCP server you configure. Every risky action — a file write, a shell command — waits on your approval and shows you exactly what it will do.",
    detail:
      "Ask it to keep what you worked out: it writes articles, saves memories, and cross-links the lot.",
    href: "/docs/sessions",
    linkLabel: "Read about sessions",
    screenshot: {
      src: "/screenshots/session.png",
      alt: "A kiri session: the assistant reports it has written an article into the project corpus and saved a memory, with the project's articles listed in the sidebar",
      title: "session — designing the forecast model",
    },
  },
  {
    eyebrow: "02 · Keep",
    title: "Keep what matters.",
    body: "Output lands as articles: readable pages with live charts and diagrams, collected in a feed — not scrollback. Facts persist as memories every future session recalls, and related work compounds into a project's shared, wiki-linked corpus.",
    detail: "Everything is searchable as you type, ⌘K from anywhere.",
    href: "/docs/sessions",
    linkLabel: "Articles, memories & projects",
    screenshot: {
      src: "/screenshots/article.png",
      alt: "An article in kiri: display typography, a table of contents, and a live bar chart rendered from an inline spec",
      title: "article — chart gallery",
    },
  },
  {
    eyebrow: "03 · Automate",
    title: "Automate the repeats.",
    body: "Anything worth doing twice hardens into a workflow: a small YAML file in your repo — shell steps piped into model steps — runnable as a one-click button. Release notes from your git log, the PR queue, the morning brief.",
    detail:
      "A session can author the workflow for you, and runs can pin one-click follow-ups to the feed.",
    href: "/docs/workflows",
    linkLabel: "Writing workflows",
    screenshot: {
      src: "/screenshots/workflows.png",
      alt: "The kiri workflows page: named workflows with descriptions, last-run status, and a run button on each",
      title: "workflows — one click each",
    },
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
    detail: "Kiri works only while you have it open. No cron, nothing in the background.",
  },
  {
    term: "Approval-gated tools",
    detail:
      "File writes show as diffs, shell commands show verbatim, MCP calls wait — until you say run.",
  },
  {
    term: "Open source",
    detail: "One binary, and every line of it on GitHub.",
  },
];

/**
 * Marketing landing page. One story told top to bottom — the ladder from
 * docs/positioning.md — with each rung proven by a real screenshot of the
 * running app. Static by design: no scroll-reveal motion, no illustrations.
 * Composed from the app's design system so the page reads as the product.
 */
export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 sm:px-8">
        <Hero />
        <Rungs />
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
          Chats become readable pages. Facts become memories. Repeated chores become one-click
          buttons. Kiri runs on your machine, against your own repo, with your own models — and
          everything it does is something you keep.
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
        <AppWindow
          src="/screenshots/feed.png"
          alt="The kiri activity feed: workflow runs with one-line summaries and article links, interleaved with chat sessions, grouped by day"
          title="the feed — everything written down"
          width={1440}
          height={900}
        />
      </div>
    </section>
  );
}

function Rungs() {
  return (
    <div>
      {RUNGS.map((rung, index) => (
        <section key={rung.title} className="border-rule border-t py-16 lg:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-14">
            <div className={index % 2 === 1 ? "lg:order-last" : undefined}>
              <Eyebrow tone="muted">{rung.eyebrow}</Eyebrow>
              <h2 className="mt-3 font-display text-3xl text-ink leading-tight">{rung.title}</h2>
              <p className="mt-5 font-mono text-sm text-ink-muted leading-relaxed">{rung.body}</p>
              <p className="mt-4 font-mono text-sm text-ink-muted leading-relaxed">{rung.detail}</p>
              <p className="mt-6 font-mono text-sm">
                <InlineLink href={rung.href}>{rung.linkLabel}</InlineLink>
              </p>
            </div>
            <AppWindow
              src={rung.screenshot.src}
              alt={rung.screenshot.alt}
              title={rung.screenshot.title}
              width={1440}
              height={900}
            />
          </div>
        </section>
      ))}
    </div>
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
