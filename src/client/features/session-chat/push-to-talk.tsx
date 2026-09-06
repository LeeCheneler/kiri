import { Button } from "../../design-system/actions/button.tsx";
import type { PushToTalkState } from "./use-push-to-talk.ts";

/**
 * The composer toolbar's push-to-talk control: a microphone glyph held to
 * record and released to transcribe into the draft (see `usePushToTalk`).
 * While the hold is live — from the microphone coming up through to the
 * capture — a pulsing red dot stands in for the glyph, and a pulsing blue
 * one while the capture is transcribed; no visible word in either state,
 * only the `sr-only` labels. The last failure is the composer's to show, on
 * its error row (see `MessageComposer`'s `error`). Renders nothing when
 * unavailable — the action doesn't exist rather than existing disabled.
 */
export function PushToTalk({ state }: { state: PushToTalkState }) {
  const { available, status, start, stop } = state;
  if (!available) return null;
  return (
    <>
      <Button
        onPressStart={start}
        onPressEnd={stop}
        title="Hold to talk; release to transcribe into the draft"
      >
        {status === "transcribing" ? (
          // A pulsing blue dot: the capture is being turned into text.
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse self-center rounded-full bg-status-running align-middle"
          />
        ) : status === "starting" || status === "recording" ? (
          // A pulsing red dot: the hold is live, from the microphone coming
          // up through to the capture itself.
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse self-center rounded-full bg-status-failed align-middle"
          />
        ) : (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="inline-block h-4 w-4 align-middle">
            {/* A microphone: held to talk, released to transcribe. */}
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
        )}
        <span className="sr-only">
          {status === "transcribing"
            ? "transcribing…"
            : status === "recording"
              ? "listening…"
              : status === "starting"
                ? "starting mic…"
                : "hold to talk"}
        </span>
      </Button>
    </>
  );
}
