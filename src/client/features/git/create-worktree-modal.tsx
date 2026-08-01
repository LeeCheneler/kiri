import { useState } from "react";
import type { CreateWorktreeResult, RepoOverview } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { PrepareReport } from "./prepare-report.tsx";
import { suggestWorktreeName } from "./suggest-name.ts";

// How the branch was resolved, said back in the terms the form used.
const BRANCH_SOURCE_COPY: Record<"local" | "remote" | "new", string> = {
  local: "checked out the branch you already had",
  remote: "tracked the branch from origin",
  new: "created the branch",
};

// What the completed create has to say: where the worktree is, what happened to
// its branch, and — when the setup ran — how each of its steps went.
function Result({ result, onClose }: { result: CreateWorktreeResult; onClose: () => void }) {
  const failed = result.status === "failed";
  return (
    <div className="flex flex-col gap-5">
      <Notice
        tone={failed ? "negative" : "informational"}
        announce="polite"
        title={failed ? "Created the worktree, but its setup failed" : "Created the worktree"}
      >
        {result.branchSource === null
          ? undefined
          : `${BRANCH_SOURCE_COPY[result.branchSource]}${
              result.baseRef === null ? "" : ` from ${result.baseRef}`
            }.`}
      </Notice>
      <div>
        <Eyebrow tone="muted">Directory</Eyebrow>
        <p className="mt-1 break-all font-mono text-ink text-xs">{result.path}</p>
      </div>
      {result.prepare ? <PrepareReport report={result.prepare} /> : null}
      <div className="flex items-center justify-end">
        <Button variant="primary" onClick={onClose}>
          done
        </Button>
      </div>
    </div>
  );
}

/**
 * Collects what a new worktree needs and creates it. The repo picker lists every
 * repo kiri found under the configured roots; the worktree name arrives
 * pre-filled with a suggestion, which names the directory `<repo>-<name>` and is
 * there to be overwritten. The branch follows that name until it is edited, so
 * the common case needs one field. The base ref only applies to a branch that
 * does not exist yet and falls back to the selected repo's default branch, shown
 * as the field's placeholder. The repo's configured setup always runs — what
 * `kiri.yaml` says a worktree needs is not a per-create decision.
 *
 * The dialog stays open through the create and swaps its form for the result:
 * where the worktree landed, how its branch was resolved, and the setup report —
 * including a failed step's output, since a failed setup still leaves a usable
 * worktree behind. A create that produced nothing keeps the form, with the
 * reason beside the actions. Built on the design-system `Modal`, so Escape and a
 * backdrop click route to `onClose`.
 */
export function CreateWorktreeModal({
  repos,
  onCreate,
  onClose,
}: {
  repos: RepoOverview[];
  onCreate: (body: {
    repo: string;
    branch: string;
    name?: string;
    baseRef?: string;
  }) => Promise<CreateWorktreeResult>;
  onClose: () => void;
}) {
  const [repo, setRepo] = useState(repos[0].name);
  // Seeded once per dialog: regenerating on every render would fight anyone
  // mid-edit, and regenerating per repo would silently discard their wording.
  const [name, setName] = useState(suggestWorktreeName);
  // The branch follows the name until it is typed into, after which the typed
  // value stands on its own — most worktrees want the two to match, and the
  // ones that don't say so explicitly.
  const [typedBranch, setTypedBranch] = useState<string | null>(null);
  const [baseRef, setBaseRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CreateWorktreeResult | null>(null);

  const selected = repos.find((candidate) => candidate.name === repo);
  const branch = typedBranch ?? name;
  const ready = branch.trim() !== "" && name.trim() !== "";

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      setResult(
        await onCreate({
          repo,
          branch: branch.trim(),
          name: name.trim(),
          baseRef: baseRef.trim() === "" ? undefined : baseRef.trim(),
        }),
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "The worktree wasn't created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="new worktree" onClose={onClose} size="lg">
      {result ? (
        <Result result={result} onClose={onClose} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
        >
          <Select label="repo" required value={repo} onChange={setRepo}>
            {repos.map((candidate) => (
              <option key={candidate.gitCommonDir} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </Select>
          <TextInput
            label="worktree name"
            description={`Names the directory ${repo}-${name.trim() === "" ? "<name>" : name.trim()}.`}
            required
            value={name}
            onChange={setName}
          />
          <TextInput
            label="branch"
            description="Follows the worktree name until you change it. Checked out when it already exists locally or on origin, otherwise created."
            required
            value={branch}
            onChange={setTypedBranch}
          />
          <TextInput
            label="base ref"
            description="The commit a new branch starts from. Defaults to the repo's default branch on origin."
            placeholder={selected?.defaultBranch ?? "the repo's default branch"}
            value={baseRef}
            onChange={setBaseRef}
          />
          <div>
            {errorMessage ? (
              <p role="alert" className="mb-3 font-mono text-sm text-status-failed">
                {errorMessage}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <Button variant="dismissive" onClick={onClose}>
                cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                pending={submitting}
                pendingLabel="creating…"
                disabled={!ready}
              >
                create
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
