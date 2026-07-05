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
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useMcpTools, useSetToolPermission } from "../../state/mcp.ts";

const PERMISSION_OPTIONS: SegmentedOption<McpToolPermission>[] = [
  { value: "allow", label: "Always allow" },
  { value: "ask", label: "Ask" },
  { value: "off", label: "Off" },
];

// One tool: its name and description on the left, its permission control on
// the right. Shared by the MCP tool rows and the built-in kiri tool rows —
// the caller supplies the permission key to record against.
function ToolRow({
  tool,
  onChange,
}: {
  tool: { name: string; description?: string; permission: McpToolPermission };
  onChange: (permission: McpToolPermission) => void;
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
          options={PERMISSION_OPTIONS}
        />
      </div>
    </div>
  );
}

// The gated built-in kiri tools: first-party session tools that execute user
// scripts, so they carry the same standing permission as an MCP tool. Open
// by default — the card is short and always present, and a permission set
// from a transcript prompt should be findable without a click.
function BuiltinCard({
  tools,
  onSetPermission,
}: {
  tools: McpBuiltinTool[];
  onSetPermission: (tool: string, permission: McpToolPermission) => void;
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-canvas-2">
      <Disclosure
        defaultOpen
        summary={
          <span className="flex items-baseline gap-3">
            <span className="font-mono text-ink text-sm">Built-in tools</span>
            <span className="ml-auto font-mono text-ink-muted text-xs uppercase tracking-widest">
              kiri
            </span>
          </span>
        }
      >
        <ul className="space-y-5">
          {tools.map((tool) => (
            <li key={tool.name}>
              <ToolRow
                tool={tool}
                onChange={(permission) => onSetPermission(tool.name, permission)}
              />
            </li>
          ))}
        </ul>
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
