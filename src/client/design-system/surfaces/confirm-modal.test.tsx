import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmModal } from "./confirm-modal.tsx";

describe("<ConfirmModal>", () => {
  it("asks the question and fires onConfirm from the confirming action", async () => {
    const user = userEvent.setup();
    const onConfirm = mock(() => {});
    const onCancel = mock(() => {});
    render(
      <ConfirmModal
        title="Delete this run?"
        body="This cannot be undone."
        confirmLabel="delete"
        variant="negative"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("This cannot be undone.")).toBeDefined();
    const confirm = screen.getByRole("button", { name: /^delete$/i });
    expect(confirm.getAttribute("data-variant")).toBe("negative");

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel from the cancel button", async () => {
    const user = userEvent.setup();
    const onConfirm = mock(() => {});
    const onCancel = mock(() => {});
    render(
      <ConfirmModal
        title="Run again?"
        body="The previous attempt will be cleared."
        confirmLabel="run again"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("routes Escape dismissal through onCancel", () => {
    const onCancel = mock(() => {});
    render(
      <ConfirmModal
        title="Run again?"
        body="The previous attempt will be cleared."
        confirmLabel="run again"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    // happy-dom doesn't model Escape firing `cancel`, so dispatch it directly.
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
