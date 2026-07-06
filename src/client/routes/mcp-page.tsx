import { Breadcrumb } from "../design-system/navigation/breadcrumb.tsx";
import { McpTools } from "../features/mcp/mcp-tools.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * The Tools & MCP route: kiri's built-in session tools and every configured
 * MCP server with its connection state, each tool carrying an Always allow /
 * Ask / Off permission control, composed into the page shell.
 */
export function McpPage() {
  return (
    <PageShell left={<SiteNav />} wide>
      <section>
        <Breadcrumb items={[]} current="Tools & MCP" />
        <div className="mt-6">
          <McpTools />
        </div>
      </section>
    </PageShell>
  );
}
