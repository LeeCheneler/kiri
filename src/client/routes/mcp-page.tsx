import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { McpTools } from "../features/mcp/mcp-tools.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * The MCP route: every configured MCP server, its connection state, and the
 * per-tool Always allow / Ask / Off permissions, composed into the page shell.
 */
export function McpPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <section>
        <Breadcrumb items={[]} current="MCP servers" />
        <div className="mt-6">
          <McpTools />
        </div>
      </section>
    </PageShell>
  );
}
