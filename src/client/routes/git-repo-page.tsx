import { RepoDetail } from "../features/git/repo-detail.tsx";
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
 * A single repo's route. The param is the repo's directory name — the same key
 * its `kiri.yaml` overrides are written under — composed into the page shell.
 */
export function GitRepoPage({ params }: { params: { repo: string } }) {
  return (
    <PageShell left={<SiteNav />} wide>
      <RepoDetail name={decodeName(params.repo)} />
    </PageShell>
  );
}
