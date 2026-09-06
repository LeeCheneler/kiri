import { Button } from "../../design-system/actions/button.tsx";
import type { PushToTalkState } from "./use-push-to-talk.ts";

/**
 * The composer toolbar's push-to-talk control: a button held to record and
 * released to transcribe into the draft (see `usePushToTalk`), with the last
 * failure inline. Renders nothing when unavailable — the action doesn't
 * exist rather than existing disabled.
 */
export function PushToTalk({ state }: { state: PushToTalkState }) {
  const { available, status, error, start, stop } = state;
  if (!available) return null;
  return (
    <>
      {error ? (
        <span role="alert" className="font-mono text-status-failed text-xs">
          {error}
        </span>
      ) : null}
      <Button
        onPressStart={start}
        onPressEnd={stop}
        pending={status === "transcribing"}
        pendingLabel="transcribing…"
        title="Hold to talk; release to transcribe into the draft"
      >
        {status === "recording" ? "listening…" : "hold to talk"}
      </Button>
    </>
  );
}
