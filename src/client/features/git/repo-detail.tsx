import type { RepoOverview } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useGitOverview } from "../../state/git.ts";
import { FetchRepo } from "./fetch-repo.tsx";
import { WorktreesSection } from "./worktrees-section.tsx";

const GIT_CRUMB = { label: "Git", href: "/git" };

// A labelled fact about the repo, for the row of them under its title.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow tone="muted">{label}</Eyebrow>
      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-ink text-sm">
        {children}
      </p>
    </div>
  );
}

// The repo itself: what it is called, where it lives, and the branch a new
// worktree is cut from. A readout and nothing else — every checkout, the primary
// included, states itself and carries its own actions in the section below.
function RepoHeader({ repo }: { repo: RepoOverview }) {
  return (
    <header className="mt-6 border-rule border-b pb-8">
      <Eyebrow>Repo</Eyebrow>
      <h2 className="mt-2 font-display text-6xl text-ink italic leading-[0.95] tracking-tight">
        {repo.name}
      </h2>
      <p className="mt-4 break-all font-mono text-ink-muted text-sm">{repo.root}</p>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
        <Fact label="Default branch">{repo.defaultBranch ?? "none"}</Fact>
      </div>
    </header>
  );
}

/**
 * A repo's own page: what the repo is, then its checkouts, with room for more
 * to arrive alongside them. Each checkout links through to its own changes.
 *
 * The header is a readout — name, path, default branch — and carries no
 * controls: an action in a row of facts is an action away from the thing it acts
 * on. The two remote actions live where they belong rather than in a band of
 * their own. Fetch is repo-level and always offered — worktrees share an object
 * store, and ahead/behind cannot be known to be stale until a fetch has happened
 * — so it sits on the breadcrumb line, saying when it last ran. The workspace
 * rescan is not here: its scope is every root, so it belongs on the listing, and
 * a staleness with no action beside it is noise. Pull is per checkout and
 * appears in that checkout's own card, only where a fast-forward would actually
 * land, so a repo with nothing to pull says nothing rather than spending a
 * section saying so.
 *
 * `name` is the repo's directory name, which is also the key its `kiri.yaml`
 * overrides are written under. Two roots can hold directories of the same name;
 * the first match in the overview's order wins, and the header states the full
 * path so it is clear which one is on screen. A name matching no repo — a stale
 * link, or one removed since — renders a not-found state rather than an empty
 * page.
 *
 * Reads the same in-memory overview the list page does, through the one shared
 * query, so a scan or an operation from anywhere lands on both without a second
 * cache key to keep in step.
 */
export function RepoDetail({ name }: { name: string }) {
  const query = useGitOverview();

  if (query.isPending) return <LoadingState>Loading repo…</LoadingState>;
  if (query.isError) {
    return (
      <Notice tone="negative" announce="polite" title="Couldn't load repo">
        {query.error instanceof Error ? query.error.message : "Try again."}
      </Notice>
    );
  }

  const repo = query.data.repos.find((candidate) => candidate.name === name);
  if (!repo) {
    return (
      <section>
        <Breadcrumb items={[GIT_CRUMB]} current="Not found" />
        <h2 className="mt-6 font-display text-4xl text-ink leading-tight">Repo not found</h2>
        <p className="mt-3 font-mono text-ink-muted text-sm">
          No repo named <code className="text-ink">{name}</code> was found under the configured
          roots.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Breadcrumb items={[GIT_CRUMB]} current={repo.name} />
        {/* One action on the breadcrumb line, saying when it last ran. How stale
            the scan is isn't here: the rescan that would fix it is
            workspace-wide, so it lives on the listing whose scope matches, and a
            staleness nobody on this page can act on is only noise. */}
        <FetchRepo repo={repo} />
      </div>
      <RepoHeader repo={repo} />
      <div className="mt-10">
        <WorktreesSection repo={repo} />
      </div>
    </section>
  );
}
