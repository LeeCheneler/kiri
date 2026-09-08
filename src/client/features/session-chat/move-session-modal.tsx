import { useState } from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { useProjects } from "../../state/projects.ts";
import { useUpdateSession } from "../../state/sessions.ts";

/** Choose a project and move the session and its articles, keeping failures open for retry. */
export function MoveSessionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const projects = useProjects();
  const { moveToProject } = useUpdateSession(id);
  const [projectId, setProjectId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMove = async () => {
    setPending(true);
    setError(null);
    try {
      await moveToProject(projectId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <Modal title="Move session to project" size="lg" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !projects.data?.some((project) => project.id === projectId)) return;
          void handleMove();
        }}
      >
        <p className="font-mono text-sm text-ink-muted">
          This session, its articles, and its delegated sessions will move into the project. The
          articles will be shared with all sessions in that project. This move cannot be undone.
        </p>
        {projects.isPending ? <LoadingState>Loading projects…</LoadingState> : null}
        {projects.isError ? (
          <p role="alert" className="font-mono text-sm text-status-failed">
            Failed to load projects: {projects.error.message}
          </p>
        ) : null}
        {projects.data?.length === 0 ? (
          <EmptyState>Create a project from the Projects page first.</EmptyState>
        ) : null}
        {projects.data && projects.data.length > 0 ? (
          <div className="self-start">
            <Select
              label="Project"
              value={projectId}
              onChange={setProjectId}
              disabled={pending}
              required
            >
              <option value="" disabled>
                Select a project…
              </option>
              {projects.data.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="font-mono text-xs text-status-failed">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={pending}
            pendingLabel="moving…"
            disabled={!projects.data?.some((project) => project.id === projectId)}
          >
            move
          </Button>
        </div>
      </form>
    </Modal>
  );
}
