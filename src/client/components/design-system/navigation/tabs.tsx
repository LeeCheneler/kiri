import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useId, useRef } from "react";
import { useSearchParams } from "wouter";

/** One entry in a tab strip: a URL id, a visible label, and the panel body. */
export type TabDef = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * Deep-linkable tab strip following the WAI-ARIA tabs pattern. The active tab
 * is held in a search param (`?<param>=<id>`, default `tab`) so panels are
 * deep-linkable and survive a reload; an unknown or absent value falls back to
 * the first tab. Arrow Left/Right (wrapping) and Home/End move focus and
 * activate in one step. Only the active panel is rendered, so a panel's content
 * — and any fetch it owns — isn't mounted until its tab is selected. `label`
 * names the strip for assistive tech. The space above the strip is the caller's;
 * it owns only the gap between the strip and its panel.
 */
export function Tabs({
  tabs,
  label,
  param = "tab",
}: {
  tabs: TabDef[];
  label: string;
  param?: string;
}) {
  const [params, setParams] = useSearchParams();
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const requested = params.get(param);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === requested),
  );
  const activeTab = tabs[activeIndex];

  const selectTab = (id: string) => {
    setParams(
      (prev) => {
        prev.set(param, id);
        return prev;
      },
      { replace: true },
    );
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = activeIndex === last ? 0 : activeIndex + 1;
        break;
      case "ArrowLeft":
        next = activeIndex === 0 ? last : activeIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-6 border-rule border-b"
      >
        {tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={`relative cursor-pointer py-3.5 font-mono text-xs uppercase tracking-widest outline-none transition-colors duration-150 focus-visible:text-accent ${
                selected
                  ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent after:content-['']"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeTab.id}`}
        aria-labelledby={`${baseId}-tab-${activeTab.id}`}
        className="mt-8"
      >
        {activeTab.content}
      </div>
    </>
  );
}
