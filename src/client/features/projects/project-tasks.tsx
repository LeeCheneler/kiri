import { useState } from "react";
import type { ProjectTask, ProjectTaskGroup } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Checkbox } from "../../design-system/actions/checkbox.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Textarea } from "../../design-system/actions/textarea.tsx";
import { Clamp } from "../../design-system/content/clamp.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Meta } from "../../design-system/content/meta.tsx";
import { ConfirmModal } from "../../design-system/surfaces/confirm-modal.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { useProjectTaskMutations, useProjectTasks } from "../../state/project-tasks.ts";

type Mutations = ReturnType<typeof useProjectTaskMutations>;

const describeError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="font-mono text-xs text-status-failed">
      {error}
    </p>
  ) : null;

// The dialog behind a group's add action: a title and an optional note,
// filed into that group.
function AddTaskModal({
  group,
  mutations,
  onClose,
}: {
  group: ProjectTaskGroup;
  mutations: Mutations;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Add task" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || title.trim() === "") return;
          setError(null);
          setPending(true);
          mutations
            .createTask(group.id, { title: title.trim(), note })
            .then(onClose, (cause: unknown) => {
              setError(describeError(cause));
              setPending(false);
            });
        }}
        className="flex flex-col gap-4"
      >
        <TextInput value={title} onChange={setTitle} label="Title" />
        <Textarea
          value={note}
          onChange={setNote}
          label="Note"
          description="Optional. Markdown — context a title can't carry."
          rows={4}
        />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={title.trim() === ""}
            pending={pending}
            pendingLabel="adding…"
          >
            add task
          </Button>
        </div>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// The dialog behind "new group": a name, nothing else — tasks come after.
function NewGroupModal({ mutations, onClose }: { mutations: Mutations; onClose: () => void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="New group" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || name.trim() === "") return;
          setError(null);
          setPending(true);
          mutations.createGroup(name.trim()).then(onClose, (cause: unknown) => {
            setError(describeError(cause));
            setPending(false);
          });
        }}
        className="flex flex-col gap-4"
      >
        <TextInput value={name} onChange={setName} label="Name" />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={name.trim() === ""}
            pending={pending}
            pendingLabel="creating…"
          >
            create
          </Button>
        </div>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// The task editor behind a row's edit action: title and markdown note,
// prefilled from the stored task, with the task's delete action alongside so
// a task's whole lifecycle sits in one place.
function EditTaskModal({
  task,
  mutations,
  onClose,
}: {
  task: ProjectTask;
  mutations: Mutations;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setPending(true);
    try {
      await work();
      onClose();
    } catch (cause) {
      setError(describeError(cause));
      setPending(false);
    }
  };

  return (
    <Modal title="Edit task" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || title.trim() === "") return;
          void run(() => mutations.updateTask(task.id, { title: title.trim(), note }));
        }}
        className="flex flex-col gap-4"
      >
        <TextInput value={title} onChange={setTitle} label="Title" />
        <Textarea
          value={note}
          onChange={setNote}
          label="Note"
          description="Markdown. Context a title can't carry — leave empty for none."
          rows={6}
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="negative-quiet"
            disabled={pending}
            onClick={() => void run(() => mutations.deleteTask(task.id))}
          >
            delete task
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="dismissive" disabled={pending} onClick={onClose}>
              cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={title.trim() === ""}
              pending={pending}
              pendingLabel="saving…"
            >
              save
            </Button>
          </div>
        </div>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// The renaming dialog behind a group's rename action.
function RenameGroupModal({
  group,
  mutations,
  onClose,
}: {
  group: ProjectTaskGroup;
  mutations: Mutations;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Rename group" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || name.trim() === "") return;
          setError(null);
          setPending(true);
          mutations.renameGroup(group.id, name.trim()).then(onClose, (cause: unknown) => {
            setError(describeError(cause));
            setPending(false);
          });
        }}
        className="flex flex-col gap-4"
      >
        <TextInput value={name} onChange={setName} label="Name" />
        <div className="flex items-center justify-end gap-3">
          <Button variant="dismissive" disabled={pending} onClick={onClose}>
            cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={name.trim() === ""}
            pending={pending}
            pendingLabel="saving…"
          >
            save
          </Button>
        </div>
        <ErrorLine error={error} />
      </form>
    </Modal>
  );
}

// One task row: the completion checkbox with the title as its label — struck
// through once done — the note beneath (clamped to a few lines until
// expanded), and the edit action trailing.
function TaskRow({
  task,
  mutations,
  onEdit,
  onError,
}: {
  task: ProjectTask;
  mutations: Mutations;
  onEdit: () => void;
  onError: (message: string | null) => void;
}) {
  const toggle = async (done: boolean) => {
    onError(null);
    try {
      await mutations.updateTask(task.id, { done });
    } catch (cause) {
      onError(describeError(cause));
    }
  };
  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className={task.done ? "line-through" : ""}>
          <Checkbox checked={task.done} onChange={(done) => void toggle(done)} label={task.title} />
        </div>
        <Meta>
          <Button variant="dismissive" size="inline" onClick={onEdit}>
            edit
          </Button>
        </Meta>
      </div>
      {task.note !== null ? (
        <div className="mt-1 ml-6">
          <Clamp>
            <p className="whitespace-pre-wrap font-mono text-xs text-ink-muted">{task.note}</p>
          </Clamp>
        </div>
      ) : null}
    </div>
  );
}

// One group: its name as the section eyebrow with its progress and actions
// trailing, then its task rows.
function TaskGroupSection({
  group,
  mutations,
  onError,
}: {
  group: ProjectTaskGroup;
  mutations: Mutations;
  onError: (message: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setConfirmDelete(false);
    onError(null);
    setDeleting(true);
    try {
      await mutations.deleteGroup(group.id);
    } catch (cause) {
      onError(describeError(cause));
      setDeleting(false);
    }
  };

  const open = group.tasks.filter((task) => !task.done).length;
  const progress = group.tasks.length === 0 ? "no tasks" : open === 0 ? "all done" : `${open} open`;

  return (
    <section aria-label={group.name}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Eyebrow tone="muted">{group.name}</Eyebrow>
        <Meta>
          <span>{progress}</span>
          <Button variant="dismissive" size="inline" onClick={() => setAdding(true)}>
            add task
          </Button>
          <Button variant="dismissive" size="inline" onClick={() => setRenaming(true)}>
            rename group
          </Button>
          <Button
            variant="negative-quiet"
            size="inline"
            pending={deleting}
            pendingLabel="deleting…"
            onClick={() => setConfirmDelete(true)}
          >
            delete group
          </Button>
        </Meta>
      </div>
      {group.tasks.length > 0 ? (
        <div className="mt-1 divide-y divide-rule">
          {group.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              mutations={mutations}
              onEdit={() => setEditing(task)}
              onError={onError}
            />
          ))}
        </div>
      ) : null}
      {adding ? (
        <AddTaskModal group={group} mutations={mutations} onClose={() => setAdding(false)} />
      ) : null}
      {editing ? (
        <EditTaskModal task={editing} mutations={mutations} onClose={() => setEditing(null)} />
      ) : null}
      {renaming ? (
        <RenameGroupModal group={group} mutations={mutations} onClose={() => setRenaming(false)} />
      ) : null}
      {confirmDelete ? (
        <ConfirmModal
          title={`Delete “${group.name}”?`}
          body={`This deletes the group and its ${group.tasks.length === 1 ? "task" : `${group.tasks.length} tasks`}. This cannot be undone.`}
          confirmLabel="delete"
          variant="negative"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * A project's task list — the Tasks tab of its page. Each group is a section
 * of checkbox rows with its progress and actions trailing the title — add a
 * task (a dialog for title and note), rename, delete — and a task editor
 * (title, note, delete) behind each row's edit action; the new-group action
 * closes the list. Kept live by the shared task queries, so a session's
 * changes appear as they land.
 */
export function ProjectTasks({ projectId }: { projectId: string }) {
  const tasks = useProjectTasks(projectId);
  const mutations = useProjectTaskMutations(projectId);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState(false);

  if (tasks.isPending) return <LoadingState>Loading tasks…</LoadingState>;
  if (tasks.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load tasks: {tasks.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {tasks.data.length === 0 ? (
        <EmptyState>
          no tasks yet. add a group to start a checklist — sessions in this project can add, tick
          off, and reorganise tasks too.
        </EmptyState>
      ) : (
        tasks.data.map((group) => (
          <TaskGroupSection key={group.id} group={group} mutations={mutations} onError={setError} />
        ))
      )}
      <ErrorLine error={error} />
      <div>
        <Button onClick={() => setNewGroup(true)}>+ New group</Button>
      </div>
      {newGroup ? <NewGroupModal mutations={mutations} onClose={() => setNewGroup(false)} /> : null}
    </div>
  );
}
