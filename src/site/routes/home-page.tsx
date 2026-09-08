import { ActionLink } from "../../client/design-system/actions/action-link.tsx";
import { Eyebrow } from "../../client/design-system/content/eyebrow.tsx";
import { InlineLink } from "../../client/design-system/content/inline-link.tsx";
import { SiteFooter } from "../chrome/site-footer.tsx";
import { SiteHeader } from "../chrome/site-header.tsx";
import { AppWindow } from "../components/app-window.tsx";

/** The public introduction: a clear promise, the running product, and short paths into using it. */
export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 sm:px-8">
        <section className="pb-12 pt-12 lg:pb-16 lg:pt-20">
          <div className="max-w-3xl">
            <Eyebrow>Your machine. Your models. Your work.</Eyebrow>
            <h1 className="mt-5 font-display text-5xl text-ink leading-[1.05] tracking-tight sm:text-7xl">
              An AI workspace for <em className="text-accent">work worth keeping.</em>
            </h1>
            <p className="mt-6 max-w-2xl font-display text-xl text-ink leading-relaxed sm:text-2xl">
              Research, write, and code with an assistant on your machine. Keep useful answers as
              pages, carry context between sessions, and turn repeat tasks into workflows.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <ActionLink href="/docs/getting-started">Get started</ActionLink>
              <ActionLink href="#in-action" variant="default">
                See Kiri in action ↓
              </ActionLink>
            </div>
            <p className="mt-5 font-mono text-xs text-ink-muted leading-relaxed">
              Open source · Bring your own model · macOS, Apple silicon
            </p>
          </div>
          <div id="in-action" className="mt-10 scroll-mt-8 lg:mt-12">
            <AppWindow
              src="/screenshots/session.png"
              alt="A Kiri session designing a forecast model: the assistant saves the decision as an article and the data-freshness preference as a memory."
              title="A decision worked through. An article to return to. Context for next time."
              width={1440}
              height={1000}
            />
          </div>
        </section>
        <section
          aria-label="What you can do with Kiri"
          className="grid gap-10 border-rule border-t py-12 md:grid-cols-3 lg:gap-12 lg:py-16"
        >
          <div>
            <Eyebrow>01 · Sessions</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink">Work through it.</h2>
            <p className="mt-4 font-display text-lg text-ink-muted leading-relaxed">
              Compare approaches, draft a plan, or fix a bug. Work with your files and tools, using
              the model you choose.
            </p>
            <p className="mt-5 font-mono text-sm">
              <InlineLink href="/docs/sessions">Start a conversation</InlineLink>
            </p>
          </div>
          <div>
            <Eyebrow>02 · Knowledge</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink">Keep what matters.</h2>
            <p className="mt-4 font-display text-lg text-ink-muted leading-relaxed">
              Save the recommendation as a readable page. Remember the constraints. Pick up the next
              conversation with your earlier work to hand.
            </p>
            <p className="mt-5 font-mono text-sm">
              <InlineLink href="/docs/projects-and-memories">Build on earlier work</InlineLink>
            </p>
          </div>
          <div>
            <Eyebrow>03 · Workflows</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink">Run it again.</h2>
            <p className="mt-4 font-display text-lg text-ink-muted leading-relaxed">
              Want a fresh project brief each week? Ask Kiri to make a workflow, then run it
              whenever you need it.
            </p>
            <p className="mt-5 font-mono text-sm">
              <InlineLink href="/docs/workflows">Make a repeat task a button</InlineLink>
            </p>
          </div>
        </section>
        <section className="border-rule border-t py-12 lg:py-16">
          <div className="mb-8 grid gap-4 md:grid-cols-2 md:gap-12">
            <div>
              <Eyebrow>A place to pick up where you left off</Eyebrow>
              <h2 className="mt-3 font-display text-3xl text-ink sm:text-4xl">
                The conversation ends.
                <br />
                The work stays useful.
              </h2>
            </div>
            <p className="font-display text-xl text-ink-muted leading-relaxed">
              In this project, the forecast model, rendering decisions, and build plan live
              alongside the conversations behind them. A new session can find the reasoning and
              carry it forward.
            </p>
          </div>
          <AppWindow
            src="/screenshots/project.png"
            alt="The Aurora project, with sessions about the forecast model and rendering approach alongside their saved decisions and build plan."
            title="One project. The conversations and decisions that build it."
            width={1440}
            height={1000}
          />
        </section>
        <section className="grid gap-8 border-rule border-t py-12 md:grid-cols-2 lg:py-16">
          <div>
            <Eyebrow>On your terms</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink">
              Local workspace. Your choice of model.
            </h2>
          </div>
          <div className="space-y-4 font-display text-lg text-ink-muted leading-relaxed">
            <p>
              Your saved work lives on your disk. Connect a cloud provider or a local model, and
              choose which files and tools the assistant can use.
            </p>
            <p>
              Kiri runs while you have it open. Cloud models and connected tools receive the data
              needed for their calls.
            </p>
            <p className="font-mono text-sm">
              <InlineLink href="/docs/llm-providers">Models &amp; providers</InlineLink>
              {" · "}
              <InlineLink href="/docs/trust-and-security">Privacy &amp; permissions</InlineLink>
            </p>
          </div>
        </section>
        <section className="border-rule border-t py-12 lg:py-16">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">
            Bring something you’re working on.
          </h2>
          <p className="mt-3 font-display text-xl text-ink-muted">
            Connect a model and start your first conversation.
          </p>
          <div className="mt-6">
            <ActionLink href="/docs/getting-started">Get started with Kiri</ActionLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
