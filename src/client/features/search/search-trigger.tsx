import { useSearchOverlay } from "./search-provider.tsx";

// ⌘ on Apple platforms, Ctrl elsewhere — cosmetic only; the shortcut
// listener accepts either modifier everywhere.
const MOD_LABEL = /mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

/**
 * The search box that opens the overlay. A button dressed as an input — the
 * real query box lives inside the overlay, so this never holds text; it just
 * advertises search and the keyboard shortcut.
 */
export function SearchTrigger() {
  const { openSearch } = useSearchOverlay();
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex w-full cursor-text items-center justify-between gap-3 border border-rule bg-canvas px-3 py-2 outline-none hover:border-ink-faint focus-visible:border-accent"
    >
      <span className="truncate font-mono text-ink-faint text-sm">
        Search articles, sessions, runs, and workflows…
      </span>
      <kbd className="shrink-0 border border-rule px-1.5 py-0.5 font-mono text-ink-faint text-xs">
        {MOD_LABEL} K
      </kbd>
    </button>
  );
}
