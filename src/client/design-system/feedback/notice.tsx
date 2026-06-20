import type { ReactNode } from "react";

/** Advisory tones, escalating from a neutral note to a problem. */
export type NoticeTone = "informational" | "warning" | "negative";

const TONE_BORDER: Record<NoticeTone, string> = {
  informational: "border-notice-info",
  warning: "border-notice-warning",
  negative: "border-notice-negative",
};

const TONE_TITLE: Record<NoticeTone, string> = {
  informational: "text-notice-info",
  warning: "text-notice-warning",
  negative: "text-notice-negative",
};

const FRAME_CLASS = "border-l-2 pl-4";

/**
 * A toned advisory callout — informational, warning, or negative — edged on the
 * left with its tone colour, leading with a tinted `title` and an optional muted
 * detail (`children`). The vocabulary for config-health findings,
 * degraded-feature notices, and similar advisories — distinct from StatusBlock,
 * which speaks the run/session status vocabulary. Exposes the tone as
 * `data-tone` for containers and tests to anchor on. Owns its border and inset
 * only; stack several with your own spacing.
 *
 * Set `announce` to make it an ARIA live region a screen reader reads out when
 * it appears or updates: `"polite"` (a native `<output>`) waits for a pause —
 * the right default for advisories; `"assertive"` interrupts. Left off, it's a
 * silent visual callout.
 */
export function Notice({
  tone,
  title,
  announce,
  children,
}: {
  tone: NoticeTone;
  title: ReactNode;
  announce?: "polite" | "assertive";
  children?: ReactNode;
}) {
  const body = (
    <>
      <p className={`font-mono text-sm ${TONE_TITLE[tone]}`}>{title}</p>
      {children ? <p className="mt-1 font-mono text-xs text-ink-muted">{children}</p> : null}
    </>
  );

  // A polite region maps to the native <output> (implicit role="status");
  // assertive has no native element, so it stays a div carrying role="alert".
  if (announce === "polite") {
    return (
      <output data-tone={tone} className={`block ${FRAME_CLASS} ${TONE_BORDER[tone]}`}>
        {body}
      </output>
    );
  }
  return (
    <div
      data-tone={tone}
      role={announce === "assertive" ? "alert" : undefined}
      className={`${FRAME_CLASS} ${TONE_BORDER[tone]}`}
    >
      {body}
    </div>
  );
}
