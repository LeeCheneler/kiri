import type { WorkflowPublishSummary } from "../../api.ts";
import { EmptyState } from "../../design-system/content/empty-state.tsx";

/**
 * The Publishes tab: a reader-facing list of what the workflow publishes — each
 * `publish:` entry's resolved editorial name, description, and its kebab slug
 * (the article's stable id). How each is produced — kind, source, env — lives in
 * the Schema tab; this is the at-a-glance view. Workflows that publish nothing
 * show an empty state.
 */
export function PublishesSpec({ entries }: { entries?: WorkflowPublishSummary[] }) {
  if (!entries || entries.length === 0) {
    return <EmptyState>this workflow publishes no articles.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-rule">
      {entries.map((entry) => (
        <li key={entry.slug} className="flex flex-col gap-1.5 px-5 py-4">
          <h4 className="font-display text-2xl text-ink leading-tight">{entry.name}</h4>
          {entry.description !== undefined && entry.description.length > 0 && (
            <p className="font-display text-sm text-ink-muted italic">{entry.description}</p>
          )}
          <span className="font-mono text-xs text-ink-faint">{entry.slug}</span>
        </li>
      ))}
    </ul>
  );
}
