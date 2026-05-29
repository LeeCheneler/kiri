import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./modal.tsx";

describe("<Modal>", () => {
  it("opens as a dialog labelled by its title", () => {
    render(
      <Modal title="Discard draft?" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    const heading = screen.getByRole("heading", { level: 2, name: /discard draft\?/i });
    expect(heading.getAttribute("id")).toBe(dialog.getAttribute("aria-labelledby"));
  });

  it("renders its children as the body", () => {
    render(
      <Modal title="Title" onClose={() => {}}>
        <p>the body content</p>
      </Modal>,
    );
    expect(screen.getByText("the body content")).toBeDefined();
  });

  it("routes the native Escape cancel event through onClose", () => {
    const onClose = mock(() => {});
    render(
      <Modal title="Title" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    // happy-dom doesn't model Escape firing `cancel`, so dispatch it directly.
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = mock(() => {});
    render(
      <Modal title="Title" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    // A backdrop click lands on the dialog element itself.
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the click is inside the content", () => {
    const onClose = mock(() => {});
    render(
      <Modal title="Title" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    // The padded wrapper is a child, so the click target is not the dialog.
    const card = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();
  });
});
