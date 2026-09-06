import { Button } from "../../design-system/actions/button.tsx";
import type { PushToTalkState, PushToTalkStatus } from "./use-push-to-talk.ts";

// What stands in for the glyph while a hold is under way: a hollow red ring
// while the microphone comes up, filling once it is live — the fill is the
// cue to speak — and a blue dot while the capture is transcribed.
const INDICATOR: Partial<Record<PushToTalkStatus, string>> = {
  starting: "border border-status-failed",
  recording: "bg-status-failed",
  transcribing: "bg-status-running",
};

const LABEL: Record<PushToTalkStatus, string> = {
  idle: "hold to talk",
  starting: "starting mic…",
  recording: "listening…",
  transcribing: "transcribing…",
};

/**
 * The composer toolbar's push-to-talk control: a microphone glyph held to
 * record and released to transcribe into the draft (see `usePushToTalk`).
 * From the press on, a pulsing indicator takes the glyph's place — a hollow
 * ring until the microphone is live, a red dot while it listens, a blue one
 * while the capture is transcribed — with no visible word; the `sr-only`
 * label carries the state for assistive tech. The last failure is the
 * composer's to show, on its error row (see `MessageComposer`'s `error`).
 * Renders nothing when unavailable — the action doesn't exist rather than
 * existing disabled.
 */
export function PushToTalk({ state }: { state: PushToTalkState }) {
  const { available, status, start, stop } = state;
  if (!available) return null;
  const indicator = INDICATOR[status];
  return (
    <>
      <Button
        onPressStart={start}
        onPressEnd={stop}
        title="Hold to talk; release to transcribe into the draft"
      >
        {/* A fixed box either way, so the button holds its size across states. */}
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 items-center justify-center align-middle"
        >
          {indicator === undefined ? (
            // A microphone.
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
              <rect
                x="5.75"
                y="1.25"
                width="4.5"
                height="8"
                rx="2.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2.5M5.5 14.75h5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <span className={`h-2 w-2 animate-pulse rounded-full ${indicator}`} />
          )}
        </span>
        <span className="sr-only">{LABEL[status]}</span>
      </Button>
    </>
  );
}
