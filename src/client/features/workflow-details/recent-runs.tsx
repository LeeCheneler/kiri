import { EmptyState } from "../../design-system/content/empty-state.tsx";

/**
 * The Recent runs tab. The scoped, infinite-scrolling run feed is being rebuilt
 * on the design system as its own piece of work; until it lands this placeholder
 * keeps the tab in place.
 */
export function RecentRuns() {
  return <EmptyState>recent runs will appear here once the feed is rebuilt.</EmptyState>;
}
