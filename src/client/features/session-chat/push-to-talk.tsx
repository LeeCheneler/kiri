import { Button } from "../../design-system/actions/button.tsx";
import type { PushToTalkState } from "./use-push-to-talk.ts";

/**
 * The composer toolbar's push-to-talk control: a microphone glyph held to
 * record and released to transcribe into the draft (see `usePushToTalk`).
 * The glyph fills while listening, reads `starting mic…` to assistive tech
 * until the microphone is live, and shows the pending dot while the capture
 * is transcribed. The last failure is the composer's to show, on its error
 * row (see `MessageComposer`'s `error`). Renders nothing when unavailable —
 * the action doesn't exist rather than existing disabled.
 */
export function PushToTalk({ state }: { state: PushToTalkState }) {
  const { available, status, start, stop } = state;
  if (!available) return null;
  const recording = status === "recording";
  return (
    <>
      <Button
        onPressStart={start}
        onPressEnd={stop}
        pending={status === "transcribing"}
        pendingLabel="transcribing…"
        title="Hold to talk; release to transcribe into the draft"
      >
        {/* A microphone: the capsule fills while it listens. */}
        <svg aria-hidden="true" viewBox="0 0 16 16" className="inline-block h-4 w-4 align-middle">
          <rect
            x="5.75"
            y="1.25"
            width="4.5"
            height="8"
            rx="2.25"
            fill={recording ? "currentColor" : "none"}
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
        <span className="sr-only">
          {recording ? "listening…" : status === "starting" ? "starting mic…" : "hold to talk"}
        </span>
      </Button>
    </>
  );
}
