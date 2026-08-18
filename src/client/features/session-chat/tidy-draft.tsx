import { Button } from "../../design-system/actions/button.tsx";
import type { TidyDraftState } from "./use-tidy-draft.ts";

// ⌘ on Apple platforms, Ctrl elsewhere — cosmetic only; the composer's
// shortcut accepts either modifier everywhere.
const MOD_LABEL = /mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

/**
 * The composer toolbar's tidy controls: a `tidy` button that rewrites the
 * draft through the utility model (see `useTidyDraft`), an `undo tidy` that
 * shows while the draft is still the untouched result, and the last failure
 * inline. Renders nothing when no utility model is configured — the action
 * doesn't exist rather than existing disabled. `empty` (nothing to tidy)
 * disables the button.
 */
export function TidyDraft({ state, empty }: { state: TidyDraftState; empty: boolean }) {
  const { available, pending, error, canUndo, tidy, undo } = state;
  if (!available) return null;
  return (
    <>
      {error ? (
        <span role="alert" className="font-mono text-status-failed text-xs">
          {error}
        </span>
      ) : null}
      {canUndo ? (
        <Button variant="dismissive" onClick={undo}>
          undo tidy
        </Button>
      ) : null}
      <Button
        onClick={tidy}
        pending={pending}
        pendingLabel="tidying…"
        disabled={empty}
        title={`Tidy the draft: fix errors and formatting (${MOD_LABEL}+Shift+F)`}
      >
        tidy
      </Button>
    </>
  );
}
