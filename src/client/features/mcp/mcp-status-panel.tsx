import { mcpAuthStartUrl } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { useMcpServers } from "../../state/mcp.ts";

/**
 * The home-page MCP status banner. Surfaces servers that aren't connected — one
 * needing OAuth sign-in as a warning Notice with a Connect action that opens the
 * sign-in flow in a new tab, one that failed to connect as a negative Notice with
 * the reason. Renders nothing while loading or when every server is connected, so
 * a healthy workspace sees no banner. Live-refreshes via `useMcpServersLive`
 * (mounted in `<LiveSync>`), so a completed sign-in clears the banner.
 */
export function McpStatusPanel() {
  const servers = (useMcpServers().data?.servers ?? []).filter((s) => s.state !== "connected");
  if (servers.length === 0) return null;
  return (
    <section aria-label="MCP servers" className="mb-8 space-y-3">
      {servers.map((server) =>
        server.state === "needs-sign-in" ? (
          <Notice
            key={server.name}
            tone="warning"
            announce="polite"
            title={`${server.name} needs sign-in`}
          >
            Authorize kiri to use this MCP server.{" "}
            <Button
              onClick={() =>
                window.open(mcpAuthStartUrl(server.name), "_blank", "noopener,noreferrer")
              }
            >
              Connect
            </Button>
          </Notice>
        ) : (
          <Notice
            key={server.name}
            tone="negative"
            announce="polite"
            title={`${server.name} failed to connect`}
          >
            {server.error ?? "The MCP server could not be reached."}
          </Notice>
        ),
      )}
    </section>
  );
}
