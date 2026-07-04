import { type CSSProperties, useEffect, useState } from "react";
import { useInView } from "./use-in-view.ts";

const PHASE_MS = 3600;

// Phase 0 — a workflow built from step cards: three steps, an article, a
// summary. Tones reuse the app's vocabulary (shell/llm steps green,
// article/summary gold); `lines` varies the card height for visual rhythm.
const WORKFLOW = [
  { key: "step-1", tone: "ok", lines: 2 },
  { key: "step-2", tone: "ok", lines: 1 },
  { key: "step-3", tone: "ok", lines: 2 },
  { key: "article", tone: "accent", lines: 1 },
  { key: "summary", tone: "accent", lines: 2 },
] as const;

// Phase 1 — an agentic session: chat, web search, response, chat, response.
// `lines` gives the bubbles varied heights (short questions, taller answers).
const SESSION = [
  { key: "q1", kind: "out", lines: 1 },
  { key: "tool", kind: "tool", lines: 0 },
  { key: "a1", kind: "in", lines: 3 },
  { key: "q2", kind: "out", lines: 1 },
  { key: "a2", kind: "in", lines: 2 },
] as const;

/**
 * Text-free hero illustration that loops between kiri's two ways to work. Each
 * phase builds itself by rising into place — a workflow as a stack of step
 * cards, then an agentic session as a chat — crossfading from one to the next
 * on a timer. Skeleton bars stand in for content. The loop is gated on viewport
 * entry and reduced motion; at rest it shows the workflow phase statically.
 */
export function HeroGraphic() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setPhase((p) => (p === 0 ? 1 : 0)), PHASE_MS);
    return () => window.clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref} className="hero-graphic" aria-hidden="true">
      <div className="hg-slide hg-wf" data-active={phase === 0}>
        {WORKFLOW.map((step, i) => (
          <div
            key={step.key}
            className="hg-item hg-wf-card"
            data-tone={step.tone}
            style={{ "--i": i } as CSSProperties}
          >
            <div className="hg-wf-head">
              <span className="hg-dot" />
              <span className="hg-bar hg-wf-title" />
            </div>
            {step.lines >= 2 ? <span className="hg-bar" /> : null}
          </div>
        ))}
      </div>

      <div className="hg-slide hg-chat" data-active={phase === 1}>
        {SESSION.map((turn, i) =>
          turn.kind === "tool" ? (
            <div key={turn.key} className="hg-item hg-tool" style={{ "--i": i } as CSSProperties}>
              <span className="hg-tool-dot" />
              <span className="hg-bar hg-bar-sm" />
            </div>
          ) : (
            <div
              key={turn.key}
              className="hg-item hg-bubble"
              data-side={turn.kind}
              style={{ "--i": i } as CSSProperties}
            >
              <span className="hg-bar" />
              {turn.lines >= 3 ? <span className="hg-bar" /> : null}
              {turn.lines >= 2 ? <span className="hg-bar hg-bar-sm" /> : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
