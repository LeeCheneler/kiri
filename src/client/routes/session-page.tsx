import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SessionActions } from "../features/session-chat/session-actions.tsx";
import { SessionArticles } from "../features/session-chat/session-articles.tsx";
import { SessionAside } from "../features/session-chat/session-aside.tsx";
import { SessionChat } from "../features/session-chat/session-chat.tsx";
import { SessionVitals } from "../features/session-chat/session-vitals.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/**
 * Session chat route. Composes the live chat into the page shell; the model
 * group (conversation model, effort, image model) lives in the chat's
 * composer, so the right rail holds the session's metadata, descending from
 * what's touched most to least — its title, its written articles, then its
 * vitals and the delete action as the quiet foot.
 */
export function SessionPage({ params }: { params: { id: string } }) {
  return (
    <PageShell
      left={<SiteNav />}
      right={
        <div className="space-y-8">
          <SessionAside id={params.id} />
          <SessionArticles id={params.id} />
          <div className="space-y-3">
            <SessionVitals id={params.id} />
            <SessionActions id={params.id} />
          </div>
        </div>
      }
    >
      <SessionChat id={params.id} />
    </PageShell>
  );
}
