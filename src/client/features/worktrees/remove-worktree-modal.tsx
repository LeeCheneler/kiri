import { useState } from "react";
import type { RemoveWorktreeResult, WorktreeStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Checkbox } from "../../design-system/actions/checkbox.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { List } from "../../design-system/content/list.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";

// The unsaved work a removal would take with it, phrased for the warning that
// gates it. Empty when there is nothing to lose.
const describeUnsavedWork = (worktree: WorktreeStatus): string => {
  const parts: string[] = [];
  if (worktree.dirty) parts.push("uncommitted changes");
  if (worktree.ahead > 0) {
    parts.push(`${worktree.ahead} commit${worktree.ahead === 1 ? "" : "s"} it hasn't pushed`);
  }
  return parts.join(" and ");
};

// The tidy-up after a successful removal: how to get the branch back, and any
// follow-up work that didn't go to plan.
function Result({ result, onClose }: { result: RemoveWorktreeResult; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Notice tone="informational" announce="polite" title="Removed the worktree">
        {result.pull === "ok" ? "Fast-forwarded the primary checkout." : undefined}
      </Notice>
      {result.deletedBranchSha && result.branch ? (
        <div>
          <Eyebrow tone="muted">Deleted branch</Eyebrow>
          <p className="mt-1 break-all font-mono text-ink text-xs">
            {result.branch} was at {result.deletedBranchSha}
          </p>
          <p className="mt-1 break-all font-mono text-ink-muted text-xs">
            Restore it with: git branch {result.branch} {result.deletedBranchSha}
          </p>
        </div>
      ) : null}
      {result.warnings.length > 0 ? (
        <div>
          <Eyebrow tone="muted">Left to you</Eyebrow>
          <div className="mt-2 font-mono text-ink-muted text-xs">
            <List>
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </List>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-end">
        <Button variant="primary" onClick={onClose}>
          done
        </Button>
      </div>
    </div>
  );
}

/**
 * Confirms removing a linked worktree, spelling out everything that goes with
 * it: the directory, its branch, and the fast-forward of the repo's primary
 * checkout. A worktree carrying unsaved work — uncommitted changes or unpushed
 * commits — names what would be lost and holds the remove behind an explicit
 * opt-in, since that work does not come back.
 *
 * The dialog stays open through the removal and swaps its confirmation for the
 * result: the sha the deleted branch was on, with the command that restores it,
 * and any follow-up the removal could not finish. A refused or failed removal
 * keeps the confirmation, with the reason beside the actions. Built on the
 * design-system `Modal`, so Escape and a backdrop click route to `onClose`.
 */
export function RemoveWorktreeModal({
  worktree,
  onRemove,
  onClose,
}: {
  worktree: WorktreeStatus;
  onRemove: (path: string, force?: boolean) => Promise<RemoveWorktreeResult>;
  onClose: () => void;
}) {
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RemoveWorktreeResult | null>(null);

  const unsaved = describeUnsavedWork(worktree);
  const blocked = unsaved !== "" && !force;

  const submit = async () => {
    if (blocked || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      setResult(await onRemove(worktree.path, force ? true : undefined));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "The worktree wasn't removed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="remove worktree" onClose={onClose}>
      {result ? (
        <Result result={result} onClose={onClose} />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <Eyebrow tone="muted">Removing</Eyebrow>
            <p className="mt-1 break-all font-mono text-ink text-xs">{worktree.path}</p>
          </div>
          <div className="font-mono text-ink text-xs">
            <List>
              <li>The directory and everything in it goes.</li>
              <li>
                {worktree.branch === null
                  ? "It has no branch to delete."
                  : `The branch ${worktree.branch} is deleted — you'll get the sha back to restore it.`}
              </li>
              <li>
                The repo's primary checkout fast-forwards if it's sitting on the default branch.
              </li>
            </List>
          </div>
          {unsaved !== "" ? (
            <>
              <Notice tone="warning" title={`This worktree has ${unsaved}.`}>
                Removing it discards that for good.
              </Notice>
              <Checkbox
                label="remove it anyway, discarding that work"
                checked={force}
                onChange={setForce}
              />
            </>
          ) : null}
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
                variant="negative"
                pending={submitting}
                pendingLabel="removing…"
                disabled={blocked}
                onClick={() => void submit()}
              >
                remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
