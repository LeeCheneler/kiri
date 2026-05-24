import type { ReactNode } from "react";

/**
 * Small "callout" box: an uppercase mono label above a left-bordered
 * content area. Used across the workflow and run detail pages to label
 * a piece of structured content (description, source, env, stdout,
 * stderr, error, stack). The primitive owns only the chrome — callers
 * supply children and decide the inner styling (paragraph, `<pre>`,
 * `<dl>`, etc.).
 *
 * `tone` defaults to `"default"` (muted label, neutral rule). Set it
 * to `"danger"` to flip the label and border to the failed-status
 * colour for error callouts. The tone is also reflected as a
 * `data-tone` attribute on the wrapping element so tests and other
 * consumers can target it semantically.
 */
export function LabelledBlock({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const labelClass =
    tone === "danger"
      ? "text-xs tracking-widest text-status-failed uppercase"
      : "text-xs tracking-widest text-ink-muted uppercase";
  const borderClass =
    tone === "danger"
      ? "mt-2 border-l-2 border-status-failed py-1 pl-3"
      : "mt-2 border-l-2 border-rule py-1 pl-3";
  return (
    <div data-tone={tone}>
      <h4 className={labelClass}>{label}</h4>
      <div className={borderClass}>{children}</div>
    </div>
  );
}
