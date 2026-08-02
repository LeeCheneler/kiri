import { ChangesDetail } from "../features/git/changes-detail.tsx";
import { PageShell } from "../features/page-shell/page-shell.tsx";
import { SiteNav } from "../features/site-nav/site-nav.tsx";

const decodeName = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed escape sequence: fall back to the raw param so the route still
    // resolves (typically to not-found) rather than crashing.
    return raw;
  }
};

/**
 * One checkout's changes, under the repo it belongs to. Both params are
 * directory names — the repo's, then the checkout's — composed into the page
 * shell at full width, since a page of unified patches needs the room.
 */
export function GitChangesPage({ params }: { params: { repo: string; checkout: string } }) {
  return (
    <PageShell left={<SiteNav />} wide>
      <ChangesDetail repo={decodeName(params.repo)} checkout={decodeName(params.checkout)} />
    </PageShell>
  );
}
