import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SessionActions } from "../features/session-chat/session-actions.tsx";
import { SessionArticles } from "../features/session-chat/session-articles.tsx";
import { SessionAside } from "../features/session-chat/session-aside.tsx";
import { SessionChat } from "../features/session-chat/session-chat.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Session chat route. Composes the live chat into the page shell, with the
 * session's details (model, tokens, start time), its written articles, and
 * the delete control in the right rail.
 */
export function SessionPage({ params }: { params: { id: string } }) {
  return (
    <PageShell
      left={<SiteNav />}
      right={
        <div className="space-y-6">
          <SessionAside id={params.id} />
          <SessionArticles id={params.id} />
          <SessionActions id={params.id} />
        </div>
      }
    >
      <SessionChat id={params.id} />
    </PageShell>
  );
}
