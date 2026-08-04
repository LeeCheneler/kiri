import {
  type McpBuiltinTool,
  type McpServerTools,
  type McpToolPermission,
  mcpAuthStartUrl,
} from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import {
  SegmentedControl,
  type SegmentedOption,
} from "../../design-system/actions/segmented-control.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useMcpTools, useSetToolPermission } from "../../state/mcp.ts";

const PERMISSION_OPTIONS: SegmentedOption<McpToolPermission>[] = [
  { value: "allow", label: "Always allow" },
  { value: "ask", label: "Ask" },
  { value: "off", label: "Off" },
];

// Auto is offered only where a per-call judgement exists — the built-in shell
// tool. Everywhere else the option is absent rather than a synonym for Ask.
const SHELL_PERMISSION_OPTIONS: SegmentedOption<McpToolPermission>[] = [
  { value: "auto", label: "Auto" },
  { value: "allow", label: "Always allow" },
  { value: "ask", label: "Ask" },
  { value: "off", label: "Off" },
];

// One tool: its name and description on the left, its permission control on
// the right. Shared by the MCP tool rows and the built-in kiri tool rows —
// the caller supplies the permission key to record against, and may widen the
// offered options where a tool supports more than the standard three.
function ToolRow({
  tool,
  onChange,
  options = PERMISSION_OPTIONS,
}: {
  tool: { name: string; description?: string; permission: McpToolPermission };
  onChange: (permission: McpToolPermission) => void;
  options?: SegmentedOption<McpToolPermission>[];
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-mono text-sm text-ink">{tool.name}</p>
        {tool.description ? (
          <p className="mt-0.5 font-display text-ink-muted text-sm italic">{tool.description}</p>
        ) : null}
      </div>
      <div className="shrink-0">
        <SegmentedControl
          aria-label={`Permission for ${tool.name}`}
          value={tool.permission}
          onChange={onChange}
          options={options}
        />
      </div>
    </div>
  );
}

// The built-in tools grouped by what they touch, in listing order. Each group
// heads its rows with a line of context; the shell and delegation lines carry
// the permission behaviour that isn't self-evident from a row — a delegated
// worker inherits only Always-allow tools, so an Ask or Auto tool's absence
// from a worker is a setting here, not a bug; and Auto needs a utility model
// to judge with.
const BUILTIN_GROUPS: readonly { title: string; blurb: string; tools: readonly string[] }[] = [
  {
    title: "Articles & images",
    blurb:
      "Standalone session output saved outside the chat — markdown articles and generated images.",
    tools: [
      "create_article",
      "replace_article",
      "edit_article",
      "list_articles",
      "read_article",
      "generate_image",
    ],
  },
  {
    title: "Skills",
    blurb: "Named instruction sets the session pulls in on demand when their task comes up.",
    tools: ["use_skill"],
  },
  {
    title: "Workflows",
    blurb: "List, read, author, and run the workspace's workflow YAML files.",
    tools: [
      "list_workflows",
      "read_workflow",
      "create_workflow",
      "edit_workflow",
      "replace_workflow",
      "run_workflow",
      "rerun_workflow",
    ],
  },
  {
    title: "Files",
    blurb:
      "Read and change files in the allowed directories — the sandbox declared under filesystem in kiri.yaml. Without one, these tools aren't offered at all.",
    tools: [
      "find_files",
      "list_directory",
      "read_file",
      "search_files",
      "set_working_directory",
      "write_file",
      "edit_file",
      "create_directory",
      "delete_file",
      "delete_directory",
    ],
  },
  {
    title: "Shell",
    blurb:
      "Auto judges each command as it's called: clearly safe commands run unprompted, anything else asks. It needs a utility model under models in kiri.yaml — without one, Auto falls back to Ask.",
    tools: ["run_command"],
  },
  {
    title: "Delegation",
    blurb:
      "A delegated worker session runs unattended, so it only holds tools set to Always allow — tools on Ask or Auto are never offered to workers.",
    tools: ["delegate"],
  },
];

// The built-in kiri tools: every first-party session tool, each carrying the
// same standing permission control as an MCP tool, grouped under subheaders
// by what the tools touch. A tool the server lists that no group claims still
// renders, in a trailing group, so it is never silently hidden. Collapsed by
// default — the card is always present and most of its tools sit on sensible
// defaults, so it opens on demand rather than pushing the MCP servers down
// the page.
function BuiltinCard({
  tools,
  onSetPermission,
}: {
  tools: McpBuiltinTool[];
  onSetPermission: (tool: string, permission: McpToolPermission) => void;
}) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const claimed = new Set(BUILTIN_GROUPS.flatMap((group) => group.tools));
  const groups = [
    ...BUILTIN_GROUPS.map((group) => ({
      title: group.title,
      blurb: group.blurb as string | undefined,
      tools: group.tools.flatMap((name) => byName.get(name) ?? []),
    })),
    { title: "Other", blurb: undefined, tools: tools.filter((tool) => !claimed.has(tool.name)) },
  ].filter((group) => group.tools.length > 0);
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-canvas-2">
      <Disclosure
        summary={
          <span className="flex items-baseline gap-3">
            <span className="font-mono text-ink text-sm">Built-in tools</span>
            <span className="ml-auto font-mono text-ink-muted text-xs uppercase tracking-widest">
              kiri
            </span>
          </span>
        }
      >
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.title}>
              <Eyebrow tone="muted">{group.title}</Eyebrow>
              {group.blurb ? (
                <p className="mt-1 font-mono text-ink-muted text-xs">{group.blurb}</p>
              ) : null}
              <ul className="mt-4 space-y-5">
                {group.tools.map((tool) => (
                  <li key={tool.name}>
                    <ToolRow
                      tool={tool}
                      onChange={(permission) => onSetPermission(tool.name, permission)}
                      options={tool.name === "run_command" ? SHELL_PERMISSION_OPTIONS : undefined}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

// One server: a collapsible card whose summary is its name and connection type,
// revealing either its tools (each with a permission control), a sign-in /
// failure notice, or an empty note. Servers that need attention (a pending
// sign-in or a connection failure) start expanded so the call-to-action shows.
function ServerCard({
  server,
  onSetPermission,
}: {
  server: McpServerTools;
  onSetPermission: (tool: string, permission: McpToolPermission) => void;
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-canvas-2">
      <Disclosure
        defaultOpen={server.state !== "connected"}
        summary={
          <span className="flex items-baseline gap-3">
            <span className="font-mono text-ink text-sm">{server.name}</span>
            <span className="ml-auto font-mono text-ink-muted text-xs uppercase tracking-widest">
              {server.type}
            </span>
          </span>
        }
      >
        {server.state === "needs-sign-in" ? (
          <Notice tone="warning" title="Needs sign-in">
            Authorize kiri to use this server.{" "}
            <Button
              onClick={() =>
                window.open(mcpAuthStartUrl(server.name), "_blank", "noopener,noreferrer")
              }
            >
              Connect
            </Button>
          </Notice>
        ) : server.state === "failed" ? (
          <Notice tone="negative" title="Failed to connect">
            {server.error ?? "The MCP server could not be reached."}
          </Notice>
        ) : server.tools.length === 0 ? (
          <EmptyState>This server exposes no tools.</EmptyState>
        ) : (
          <ul className="space-y-5">
            {server.tools.map((tool) => (
              <li key={tool.namespacedName}>
                <ToolRow
                  tool={tool}
                  onChange={(permission) => onSetPermission(tool.namespacedName, permission)}
                />
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  );
}

/**
 * The tool-permission management surface: the gated built-in kiri tools, then
 * every configured MCP server as a collapsible card showing its connection
 * state, revealing under each connected one its tools, each carrying an
 * Always allow / Ask / Off control. Setting a permission persists it and is
 * enforced from the next turn — an "Off" tool is never offered to the model.
 * Live-refreshes via `useMcpToolsLive`, so a completed sign-in fills a
 * server's tools in.
 */
export function McpTools() {
  const query = useMcpTools();
  const setPermission = useSetToolPermission();
  if (query.isPending) return <LoadingState>Loading MCP servers…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load MCP servers">
        {query.error instanceof Error ? query.error.message : "Try again."}
      </Notice>
    );
  }
  const { servers, builtin } = query.data;
  const onSetPermission = (tool: string, permission: McpToolPermission) =>
    void setPermission(tool, permission);
  return (
    <div className="space-y-4">
      {builtin.length > 0 ? (
        <BuiltinCard tools={builtin} onSetPermission={onSetPermission} />
      ) : null}
      {servers.length === 0 ? (
        <EmptyState>
          No MCP servers are configured — add one under mcp in your kiri.yaml.
        </EmptyState>
      ) : (
        servers.map((server) => (
          <ServerCard key={server.name} server={server} onSetPermission={onSetPermission} />
        ))
      )}
    </div>
  );
}
