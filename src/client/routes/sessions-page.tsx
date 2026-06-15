import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SessionsIndex } from "../features/session-chat/sessions-index.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Sessions index route. Composes the sessions surface (start a session + the
 * session list) into the page shell.
 */
export function SessionsPage() {
  return (
    <PageShell left={<SiteNav />}>
      <SessionsIndex />
    </PageShell>
  );
}
