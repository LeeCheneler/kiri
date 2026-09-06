import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button.tsx";

describe("<Button>", () => {
  it("renders the children as the label", () => {
    render(<Button>copy</Button>);
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDefined();
  });

  it("defaults to the outlined default variant exposed via data-variant", () => {
    render(<Button>copy</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("default");
  });

  it("exposes the primary variant via data-variant for the headline action", () => {
    render(<Button variant="primary">run</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("primary");
  });

  it("exposes the negative variant via data-variant for destructive actions", () => {
    render(<Button variant="negative">delete</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("negative");
  });

  it("exposes the negative-quiet variant via data-variant for low-weight destructive actions", () => {
    render(<Button variant="negative-quiet">delete</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("negative-quiet");
  });

  it("exposes the dismissive variant via data-variant for low-weight actions", () => {
    render(<Button variant="dismissive">cancel</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("dismissive");
  });

  it("fires onClick when the user clicks", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(<Button onClick={onClick}>copy</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick.mock.calls.length).toBe(1);
  });

  it("does not fire onClick while disabled", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(
      <Button disabled onClick={onClick}>
        copy
      </Button>,
    );
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(onClick.mock.calls.length).toBe(0);
  });

  it("swaps the label for the pending label and disables itself while pending", () => {
    render(
      <Button pending pendingLabel="cancelling…">
        cancel
      </Button>,
    );
    const button = screen.getByRole("button", { name: /cancelling…/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).not.toContain("cancel run");
    expect(screen.queryByText(/^cancel$/)).toBeNull();
  });

  it("forwards type and title to the underlying button element", () => {
    render(
      <Button type="submit" title="run the workflow">
        run →
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("title")).toBe("run the workflow");
  });

  describe("hold actions", () => {
    const press = (button: HTMLElement, init: Record<string, unknown> = {}) =>
      fireEvent.pointerDown(button, { button: 0, pointerId: 1, ...init });

    it("fires onPressStart on pointer down and onPressEnd on pointer up", () => {
      const onPressStart = mock(() => {});
      const onPressEnd = mock(() => {});
      render(
        <Button onPressStart={onPressStart} onPressEnd={onPressEnd}>
          hold
        </Button>,
      );
      const button = screen.getByRole("button");

      press(button);
      expect(onPressStart).toHaveBeenCalledTimes(1);
      expect(onPressEnd).toHaveBeenCalledTimes(0);

      fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
      expect(onPressEnd).toHaveBeenCalledTimes(1);
    });

    it("ends the hold on pointer cancel and ignores a secondary button", () => {
      const onPressStart = mock(() => {});
      const onPressEnd = mock(() => {});
      render(
        <Button onPressStart={onPressStart} onPressEnd={onPressEnd}>
          hold
        </Button>,
      );
      const button = screen.getByRole("button");

      press(button, { button: 2 });
      expect(onPressStart).toHaveBeenCalledTimes(0);

      fireEvent.pointerCancel(button, { pointerId: 1 });
      expect(onPressEnd).toHaveBeenCalledTimes(1);
    });

    it("drives the hold from Space or Enter, once per press despite key repeat", async () => {
      const user = userEvent.setup();
      const onPressStart = mock(() => {});
      const onPressEnd = mock(() => {});
      render(
        <Button onPressStart={onPressStart} onPressEnd={onPressEnd}>
          hold
        </Button>,
      );
      const button = screen.getByRole("button");
      button.focus();

      fireEvent.keyDown(button, { key: " " });
      fireEvent.keyDown(button, { key: " ", repeat: true });
      expect(onPressStart).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(button, { key: " " });
      expect(onPressEnd).toHaveBeenCalledTimes(1);

      await user.keyboard("{Enter>}");
      expect(onPressStart).toHaveBeenCalledTimes(2);
      await user.keyboard("{/Enter}");
      expect(onPressEnd).toHaveBeenCalledTimes(2);

      // Other keys are not the hold's business.
      fireEvent.keyDown(button, { key: "a" });
      fireEvent.keyUp(button, { key: "a" });
      expect(onPressStart).toHaveBeenCalledTimes(2);
      expect(onPressEnd).toHaveBeenCalledTimes(2);
    });

    it("attaches no hold handling to a plain click button", () => {
      const onClick = mock(() => {});
      render(<Button onClick={onClick}>copy</Button>);
      const button = screen.getByRole("button");

      press(button);
      fireEvent.keyDown(button, { key: " " });
      expect(onClick).toHaveBeenCalledTimes(0);
    });
  });
});
