import { mock } from "bun:test";

/**
 * Props the real `react-vega` `VegaEmbed` is handed. The stub records the
 * most recent set so tests can assert on the spec/options wiring and
 * drive the `onError` degradation path.
 */
export interface CapturedEmbed {
  spec: unknown;
  options: Record<string, unknown>;
  onError: (error: unknown) => void;
}

let captured: CapturedEmbed | null = null;

function VegaEmbedStub(props: CapturedEmbed) {
  captured = props;
  return <div />;
}

/**
 * Replace `react-vega` with a lightweight stub. Vega is ~290 KB and does
 * not render meaningfully under happy-dom — a real chart is exercised by
 * the Playwright suite. Call this at the top of any test file that
 * (transitively) renders a chart, before importing the subject module,
 * so every importer binds the same stub regardless of module load order.
 */
export function mockReactVega(): void {
  mock.module("react-vega", () => ({ VegaEmbed: VegaEmbedStub }));
}

/** Props from the most recent `VegaEmbed` render, or null if none. */
export function lastEmbed(): CapturedEmbed | null {
  return captured;
}

/** Forget any captured props — call between tests. */
export function resetEmbed(): void {
  captured = null;
}
