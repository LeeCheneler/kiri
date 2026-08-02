import type { RepoOverview } from "../../api.ts";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Breadcrumb } from "../../design-system/navigation/breadcrumb.tsx";
import { formatRelativeTime } from "../../formatters/format-time.ts";
import { useGitOverview, useUpdateRepo } from "../../state/git.ts";
import { SyncFailure } from "./sync-outcome.tsx";
import { UpdateAction, useUpdate } from "./update.tsx";
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

// When the repo last heard from its remote, read from git's own record — so it
// counts a fetch run in a terminal too, and a repo that has never fetched says
// so rather than being rounded to just now.
function LastUpdated({ at }: { at: string | null }) {
  return (
    <p className="text-ink-muted text-xs" aria-live="polite">
      {at === null ? "Never updated" : `Updated ${formatRelativeTime(at)}`}
    </p>
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
 * on. The one remote action lives on the breadcrumb line, with when the repo
 * last heard from its remote beside it: update fetches the repo and
 * fast-forwards every checkout of it that can take one, and is always offered,
 * since ahead/behind cannot be known to be stale until a fetch has happened.
 * There is nothing beside it: an update rescans as part of settling, so a
 * separate rescan would be a second button meaning almost the same.
 *
 * An update that worked says nothing — the checkouts it moved stop being behind.
 * A fetch that never landed reports beside the action, since it is the repo's
 * own; a checkout that could not be fast-forwarded reports in that checkout's
 * card, with its reason.
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
  const updateRepo = useUpdateRepo();
  const update = useUpdate(async () => [await updateRepo(name)]);

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

  const failure = update.report.get(repo.name);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Breadcrumb items={[GIT_CRUMB]} current={repo.name} />
        {/* One action on the breadcrumb line, saying when the repo last heard
            from its remote. How stale the scan is isn't here: it is a fact about
            the whole workspace, and the listing whose scope matches states it. */}
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <LastUpdated at={repo.lastFetchedAt} />
            <UpdateAction label="Update" update={update} />
          </div>
          {/* A fetch that never landed is the repo's own, so it reports beside
              the action; what its checkouts could not do reports on each of
              them, in the section below. */}
          {failure?.fetch ? <SyncFailure result={failure.fetch} /> : null}
        </div>
      </div>
      <RepoHeader repo={repo} />
      <div className="mt-10">
        <WorktreesSection repo={repo} failures={failure?.checkouts ?? []} />
      </div>
    </section>
  );
}
