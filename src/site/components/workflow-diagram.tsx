import type { CSSProperties } from "react";
import { useInView } from "./use-in-view.ts";

type Tone = "step" | "article" | "feed";
type Node = { label: string; tag?: string; tone: Tone };

// The shape of the hero workflow, told as a pipeline: shell + model steps
// flow into an article, a summary step, and finally the activity feed.
// Mirrors what kiri actually does so the motion teaches the model.
const NODES: Node[] = [
  { label: "Collect changes", tag: "sh", tone: "step" },
  { label: "Draft the notes", tag: "llm", tone: "step" },
  { label: "Write the article", tag: "articles", tone: "article" },
  { label: "Summarize the run", tag: "llm", tone: "step" },
  { label: "Into the feed", tone: "feed" },
];

/**
 * Animated illustration of a workflow run for the landing page: a vertical
 * pipeline whose steps cascade in and a spark traces top-to-bottom when it
 * scrolls into view, ending with a summary card landing in the feed. Purely
 * decorative — gated on viewport entry and neutralised under reduced motion.
 */
export function WorkflowDiagram() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-play={inView} className="diagram" aria-hidden="true">
      <ol className="wf-track">
        {NODES.map((node, i) => (
          <li
            key={node.label}
            className="wf-node"
            data-tone={node.tone}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="wf-dot" />
            <span className="wf-name">{node.label}</span>
            {node.tag ? <span className="wf-tag">{node.tag}</span> : null}
          </li>
        ))}
        <span className="wf-spark" />
      </ol>
      <div className="wf-feed" style={{ "--i": NODES.length } as CSSProperties}>
        <span className="wf-feed-dot" />
        <div className="wf-feed-body">
          <span className="wf-feed-title">Release Notes</span>
          <span className="wf-feed-meta">article · summarized</span>
        </div>
      </div>
    </div>
  );
}
