import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SessionArticles } from "../features/session-chat/session-articles.tsx";
import { SessionChat } from "../features/session-chat/session-chat.tsx";
import { SessionChildren } from "../features/session-chat/session-children.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

/** Session chat with a bounded reference rail; metadata and management open from its header. */
export function SessionPage({ params }: { params: { id: string } }) {
  return (
    <PageShell
      left={<SiteNav />}
      right={
        <div className="hidden max-h-[calc(100dvh-4rem)] space-y-8 overflow-y-auto lg:block">
          <SessionChildren id={params.id} activeOnly />
          <SessionArticles key={params.id} id={params.id} />
        </div>
      }
    >
      <SessionChat id={params.id} />
    </PageShell>
  );
}
