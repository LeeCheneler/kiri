import { mock } from "bun:test";

type Outcome = { svg: string } | { error: string };

const DEFAULT_SVG = '<svg aria-roledescription="flowchart"><g><text>A</text></g></svg>';

let outcome: Outcome = { svg: DEFAULT_SVG };
let lastSource: string | null = null;

/**
 * Replace the `mermaid` module with a lightweight stub. mermaid is ~1 MB and
 * relies on SVG layout measurement that happy-dom doesn't implement — a real
 * diagram is exercised by the Playwright suite. Call this before importing the
 * subject module, so every importer binds the same stub regardless of load
 * order. `render` resolves to the configured outcome; `initialize` is a no-op.
 */
export function mockMermaid(): void {
  mock.module("mermaid", () => ({
    default: {
      initialize: () => {},
      render: async (_id: string, source: string) => {
        lastSource = source;
        if ("error" in outcome) throw new Error(outcome.error);
        return { svg: outcome.svg, diagramType: "flowchart", bindFunctions: undefined };
      },
    },
  }));
}

/** Set what the next `mermaid.render` call resolves to (or rejects with). */
export function setMermaidOutcome(next: Outcome): void {
  outcome = next;
}

/** The source string handed to the most recent `render`, or null if none. */
export function lastMermaidSource(): string | null {
  return lastSource;
}

/** Restore the default success outcome and forget the last source. */
export function resetMermaid(): void {
  outcome = { svg: DEFAULT_SVG };
  lastSource = null;
}
