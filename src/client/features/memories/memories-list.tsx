import { useState } from "react";
import type { MemorySummary } from "../../api.ts";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { HeadlineLink } from "../../design-system/content/headline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useMemories } from "../../state/memories.ts";

// Substring filter across name and description (case-insensitive). An empty
// query passes everything.
const filterMemories = (memories: MemorySummary[], query: string): MemorySummary[] => {
  const q = query.trim().toLowerCase();
  if (q === "") return memories;
  return memories.filter(
    (memory) =>
      memory.name.toLowerCase().includes(q) || memory.description.toLowerCase().includes(q),
  );
};

function MemoryRow({ memory, now }: { memory: MemorySummary; now?: Date }) {
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xl">
          <HeadlineLink href={`/memories/${encodeURIComponent(memory.name)}`}>
            {memory.name}
          </HeadlineLink>
        </span>
        <Meta>
          <span>updated {formatRelativeTime(memory.updatedAt, now)}</span>
        </Meta>
      </div>
      <p className="mt-1 font-mono text-sm text-ink-muted">{memory.description}</p>
    </div>
  );
}

/**
 * The memory index: every durable fact sessions have saved, filterable and
 * each linking to its detail page for reading, editing, and deleting. Kept
 * live by the shared memory queries, so a session saving a memory mid-turn
 * pops into the list without a reload. `now` is injectable so tests render
 * deterministic relative times.
 */
export function MemoriesList({ now }: { now?: Date }) {
  const memories = useMemories();
  const [query, setQuery] = useState("");

  return (
    <section>
      <Breadcrumb items={[]} current="Memories" />
      <div className="mt-6 max-w-sm">
        <TextInput value={query} onChange={setQuery} placeholder="Filter memories…" />
      </div>
      <div className="mt-8">
        <Body memories={memories} query={query} now={now} />
      </div>
    </section>
  );
}

function Body({
  memories,
  query,
  now,
}: {
  memories: ReturnType<typeof useMemories>;
  query: string;
  now?: Date;
}) {
  if (memories.isPending) return <LoadingState>Loading memories…</LoadingState>;
  if (memories.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load memories: {memories.error.message}
      </p>
    );
  }

  if (memories.data.length === 0) {
    return (
      <EmptyState>
        no memories yet. sessions save durable facts here as you chat — tell kiri to remember
        something and it lands in this list.
      </EmptyState>
    );
  }

  const matched = filterMemories(memories.data, query);
  if (matched.length === 0) {
    return <EmptyState>No memories match “{query.trim()}”.</EmptyState>;
  }

  return (
    <div className="divide-y divide-rule">
      {matched.map((memory) => (
        <MemoryRow key={memory.name} memory={memory} now={now} />
      ))}
    </div>
  );
}
