import type { RepoOverview } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Tag } from "../../design-system/content/tag.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { useGitOverview } from "../../state/git.ts";
import { ChangesLink } from "./changes-link.tsx";
import { RemoteSection } from "./remote-section.tsx";
import { ScanStatus } from "./scan-status.tsx";
import { branchLabel, stateTags } from "./worktree-state.ts";
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

// The repo itself: where it lives, the branch a new one is cut from, and what
// its primary checkout is sitting on and carrying — the state a reader needs
// before deciding anything on the sections below.
function RepoHeader({ repo }: { repo: RepoOverview }) {
  const primary = repo.worktrees.find((worktree) => worktree.primary);
  return (
    <header className="mt-6 border-rule border-b pb-8">
      <Eyebrow>Repo</Eyebrow>
      <h2 className="mt-2 font-display text-6xl text-ink italic leading-[0.95] tracking-tight">
        {repo.name}
      </h2>
      <p className="mt-4 break-all font-mono text-ink-muted text-sm">{repo.root}</p>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
        <Fact label="Default branch">{repo.defaultBranch ?? "none"}</Fact>
        {primary ? (
          // The way into the primary checkout's changes belongs beside the
          // primary checkout itself; it has no row in the Worktrees section,
          // which lists only the linked ones.
          <Fact label="Primary checkout">
            {branchLabel(primary)}
            {stateTags(primary).map((tag) => (
              <Tag key={tag.label} tone={tag.tone}>
                {tag.label}
              </Tag>
            ))}
            <ChangesLink repo={repo} worktree={primary} />
          </Fact>
        ) : null}
      </div>
    </header>
  );
}

/**
 * A repo's own page: what the repo is, then a stack of sections managing it —
 * its standing with its remote and its worktrees, with room for the rest to
 * arrive alongside them. Each checkout links through to its own changes.
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
        <ScanStatus overview={query.data} />
      </div>
      <RepoHeader repo={repo} />
      <div className="mt-10 space-y-10">
        <RemoteSection repo={repo} />
        <WorktreesSection repo={repo} />
      </div>
    </section>
  );
}
