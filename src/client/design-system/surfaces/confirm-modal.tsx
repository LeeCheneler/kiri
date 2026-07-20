import { Button } from "../actions/button.tsx";
import { Prose } from "../content/prose.tsx";
import { Modal } from "./modal.tsx";

/**
 * Confirmation dialog for a single yes/no decision — the in-app replacement
 * for the browser's native confirm. Composes `Modal`, so it is open while
 * mounted: render it to ask, and unmount it on either callback. `title` asks
 * the question, `body` states the consequence, and `confirmLabel` names the
 * confirming action; `variant` sets that button's emphasis — `negative` for
 * destructive actions, `primary` (default) otherwise. The cancel button,
 * Escape, and a backdrop click all route to `onCancel`.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  variant = "primary",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  variant?: "primary" | "negative";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <Prose>
        <p>{body}</p>
      </Prose>
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="dismissive" onClick={onCancel}>
          cancel
        </Button>
        <Button variant={variant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
