import type { CSSProperties } from "react";
import { useInView } from "./use-in-view.ts";

type Turn =
  | { role: "user"; text: string }
  | { role: "tool"; text: string }
  | { role: "assistant"; text: string };

// A short agentic exchange: a question, a web-search tool call that resolves,
// an answer in chat, then a follow-up answered the same way. The tool turn
// shows the tool "working" then settling, mirroring how a session streams.
const TURNS: Turn[] = [
  { role: "user", text: "What changed in our deps this week?" },
  { role: "tool", text: "web search" },
  { role: "assistant", text: "Pulled the changelogs — three bumps, one breaking." },
  { role: "user", text: "Which one breaks?" },
  { role: "assistant", text: "react-router v7 — the loader API. Here's the migration." },
];

/**
 * Animated illustration of an agentic session for the landing page: chat turns
 * reveal in sequence as it scrolls into view, with the tool turn showing a
 * brief working state before it resolves. Purely decorative — gated on viewport
 * entry and neutralised under reduced motion.
 */
export function SessionDiagram() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-play={inView} className="diagram" aria-hidden="true">
      <ol className="se-track">
        {TURNS.map((turn, i) => (
          <li
            key={turn.text}
            className="se-turn"
            data-role={turn.role}
            style={{ "--i": i } as CSSProperties}
          >
            {turn.role === "tool" ? (
              <span className="se-tool">
                <span className="se-tool-dot" />
                <span className="se-tool-label">{turn.text}</span>
              </span>
            ) : (
              <span className="se-bubble">{turn.text}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
