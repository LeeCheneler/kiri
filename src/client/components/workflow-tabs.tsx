import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from "react";
import { useSearchParams } from "wouter";

/** Query-string key tracking which workflow tab is active. */
export const WORKFLOW_TAB_PARAM = "tab";

/** One entry in the workflow tab strip: a URL id, a visible label, and the panel body. */
export type WorkflowTabDef = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * Tab strip for the workflow detail page, following the WAI-ARIA tabs
 * pattern. The active tab is held in the URL (`?tab=<id>`) so panels are
 * deep-linkable; an unknown or absent `?tab` falls back to the first tab.
 *
 * Arrow Left/Right (wrapping) and Home/End move focus *and* activate
 * (automatic activation). Only the active panel is rendered, so a tab's
 * content isn't mounted — and any fetch it owns isn't fired — until the
 * tab is selected. `rightTabId` pulls one tab to the right edge as a
 * secondary affordance.
 */
export function WorkflowTabs({
  tabs,
  rightTabId,
}: {
  tabs: WorkflowTabDef[];
  rightTabId?: string;
}) {
  const [params, setParams] = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const requested = params.get(WORKFLOW_TAB_PARAM);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === requested),
  );
  const activeTab = tabs[activeIndex];

  const selectTab = (id: string) => {
    setParams(
      (prev) => {
        prev.set(WORKFLOW_TAB_PARAM, id);
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
        aria-label="Workflow views"
        onKeyDown={onKeyDown}
        className="mt-8 flex gap-6 border-rule border-b"
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
              id={`wf-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`wf-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={`relative cursor-pointer py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] outline-none transition-colors duration-150 focus-visible:text-accent ${
                selected
                  ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent after:content-['']"
                  : "text-ink-muted hover:text-ink"
              }${tab.id === rightTabId ? " ml-auto border-rule border-l pl-6" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`wf-panel-${activeTab.id}`}
        aria-labelledby={`wf-tab-${activeTab.id}`}
        className="mt-8"
      >
        {activeTab.content}
      </div>
    </>
  );
}
