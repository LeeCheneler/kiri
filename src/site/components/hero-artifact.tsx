import type { CSSProperties } from "react";
import { CodeWindow } from "./code-window.tsx";
import { useInView } from "./use-in-view.ts";

const WORKFLOW_YAML = `name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    name: Collect changes
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{KIRI_INPUT}}
    id: draft
articles:
  - slug: release-notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/release-notes.tpl
    env:
      DRAFT: { step: draft }
`;

/** The rendered-article half of the hero: the page the workflow run produced. */
function ArticleWindow() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border border-rule">
      <div className="flex items-center justify-between border-rule border-b bg-paper-2 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-faint tracking-wide">Release Notes</span>
        <span className="rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[0.625rem] text-accent uppercase tracking-widest">
          article
        </span>
      </div>
      <div className="flex-1 bg-paper p-5 sm:p-6">
        <p className="font-display text-2xl text-ink italic leading-tight">
          v1.5.0 — Sharper sessions
        </p>
        <p className="mt-5 font-mono text-xs text-ink-faint uppercase tracking-widest">Features</p>
        <ul className="mt-2 space-y-1.5 font-mono text-sm text-ink-muted leading-relaxed">
          <li>· One-click review buttons on the PR queue</li>
          <li>· OAuth sign-in for MCP servers</li>
        </ul>
        <p className="mt-4 font-mono text-xs text-ink-faint uppercase tracking-widest">Fixes</p>
        <ul className="mt-2 space-y-1.5 font-mono text-sm text-ink-muted leading-relaxed">
          <li>· Context gauge counts tool results once</li>
        </ul>
        <div className="mt-6 flex items-center gap-2.5 border-rule border-t pt-4">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="font-mono text-xs text-ink-faint">
            Two features and a fix since v1.4.0 — into the feed.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero's input → output artifact: the workflow file on one side, the Run
 * action between, and the article that run produced on the other. The three
 * pieces rise in reading order when scrolled into view; the resting state is
 * fully visible, so no-JS and reduced-motion readers see the finished band.
 */
export function HeroArtifact() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-play={inView}
      className="hero-artifact grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-5"
    >
      <div className="ha-item" style={{ "--i": 0 } as CSSProperties}>
        <CodeWindow filename="workflows/release-notes.yaml">{WORKFLOW_YAML}</CodeWindow>
      </div>
      <div
        className="ha-item flex items-center justify-center gap-2 lg:flex-col"
        style={{ "--i": 1 } as CSSProperties}
        aria-hidden="true"
      >
        <span className="font-mono text-xs text-accent uppercase tracking-widest">Run</span>
        <span className="hidden font-mono text-accent text-lg lg:block">→</span>
        <span className="font-mono text-accent text-lg lg:hidden">↓</span>
      </div>
      <div className="ha-item" style={{ "--i": 2 } as CSSProperties}>
        <ArticleWindow />
      </div>
    </div>
  );
}
